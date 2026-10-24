import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CookieJar } from 'tough-cookie';
import { RedisService } from '../../redis/redis.service';
import { CaptchaSession } from '../university-validation.types';

interface StoredCaptchaSession {
  sessionId: string;
  userId?: string;
  captchaImageBase64?: string;
  authCode?: string;
  enrollmentNumber?: string;
  hiddenInputs?: Record<string, string>;
  pageUrl?: string;
  formActionUrl?: string;
  createdAt: string;
  cookieJar: ReturnType<CookieJar['toJSON']>;
}

@Injectable()
export class SessionManagementService {
  private readonly logger = new Logger(SessionManagementService.name);
  // Keep only bounded eviction metadata locally. Sensitive session contents live
  // in Redis with a TTL, so every replica expires them without a local timer.
  private readonly sessionCreatedAt = new Map<string, number>();
  private readonly sessionTtlMs: number;
  private readonly sessionTtlSeconds: number;
  private readonly maxSessions: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.sessionTtlMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_SESSION_TTL_MS', 15 * 60 * 1000);
    this.sessionTtlSeconds = Math.max(1, Math.ceil(this.sessionTtlMs / 1000));
    this.maxSessions = this.readPositiveInteger('UNIVERSITY_EXTERNAL_MAX_SESSIONS', 500);
  }

  async createSession(sessionId: string): Promise<CaptchaSession> {
    const session: CaptchaSession = {
      sessionId,
      cookieJar: new CookieJar(),
      createdAt: new Date(),
    };

    await this.storeSession(session);
    this.logger.debug('Created university validation session');
    return session;
  }

  async getSession(sessionId: string): Promise<CaptchaSession | undefined> {
    let serialized: string | null;
    try {
      serialized = await this.redis.get(this.redisKey(sessionId));
    } catch (error) {
      // Redis remains authoritative when a replica cannot reach it.
      this.logger.error('Unable to read university validation session from Redis', this.errorMessage(error));
      this.sessionCreatedAt.delete(sessionId);
      return undefined;
    }

    if (!serialized) {
      this.sessionCreatedAt.delete(sessionId);
      return undefined;
    }

    const session = this.deserializeSession(serialized);
    if (!session || this.isExpired(session)) {
      await this.deleteSession(sessionId);
      return undefined;
    }

    // Reading a shared session must not evict another live session from Redis.
    // Only writes add entries to this replica's bounded eviction metadata.
    await this.cleanupOldSessions();
    return session;
  }

  async getOwnedSession(sessionId: string, userId: string): Promise<CaptchaSession | undefined> {
    const session = await this.getSession(sessionId);
    return session?.userId === userId ? session : undefined;
  }

  async storeSession(session: CaptchaSession): Promise<void> {
    const payload = this.serializeSession(session);
    await this.redis.set(this.redisKey(session.sessionId), JSON.stringify(payload), this.sessionTtlSeconds);
    await this.trackSession(session);
  }

  private async trackSession(session: CaptchaSession): Promise<void> {
    await this.cleanupOldSessions();

    if (!this.sessionCreatedAt.has(session.sessionId) && this.sessionCreatedAt.size >= this.maxSessions) {
      const oldestSessionId = this.sessionCreatedAt.keys().next().value;
      if (oldestSessionId) {
        await this.deleteSession(oldestSessionId);
        this.logger.warn('Evicted oldest university validation session after reaching the session limit');
      }
    }

    this.sessionCreatedAt.set(session.sessionId, session.createdAt.getTime());
  }

  async deleteSession(sessionId: string): Promise<void> {
    this.sessionCreatedAt.delete(sessionId);

    try {
      await this.redis.del(this.redisKey(sessionId));
    } catch (error) {
      // Redis TTL bounds the lifetime of a session when explicit deletion fails.
      this.logger.error('Unable to delete university validation session from Redis', this.errorMessage(error));
    }
    this.logger.debug('Deleted university validation session');
  }

  async cleanupOldSessions(): Promise<void> {
    const expiredSessionIds = [...this.sessionCreatedAt.entries()]
      .filter(([, createdAt]) => createdAt + this.sessionTtlMs <= Date.now())
      .map(([sessionId]) => sessionId);

    await Promise.all(expiredSessionIds.map((sessionId) => this.deleteSession(sessionId)));
  }

  private serializeSession(session: CaptchaSession): StoredCaptchaSession {
    return {
      sessionId: session.sessionId,
      userId: session.userId,
      captchaImageBase64: session.captchaImageBase64,
      authCode: session.authCode,
      enrollmentNumber: session.enrollmentNumber,
      hiddenInputs: session.hiddenInputs,
      pageUrl: session.pageUrl,
      formActionUrl: session.formActionUrl,
      createdAt: session.createdAt.toISOString(),
      cookieJar: session.cookieJar.toJSON(),
    };
  }

  private deserializeSession(serialized: string): CaptchaSession | undefined {
    try {
      const payload = JSON.parse(serialized) as Partial<StoredCaptchaSession>;
      if (
        typeof payload.sessionId !== 'string' ||
        typeof payload.createdAt !== 'string' ||
        !payload.cookieJar ||
        typeof payload.cookieJar !== 'object'
      ) {
        return undefined;
      }

      const createdAt = new Date(payload.createdAt);
      if (Number.isNaN(createdAt.getTime())) {
        return undefined;
      }

      return {
        sessionId: payload.sessionId,
        userId: typeof payload.userId === 'string' ? payload.userId : undefined,
        captchaImageBase64: this.optionalString(payload.captchaImageBase64),
        authCode: this.optionalString(payload.authCode),
        enrollmentNumber: this.optionalString(payload.enrollmentNumber),
        hiddenInputs: this.recordOfStrings(payload.hiddenInputs),
        pageUrl: this.optionalString(payload.pageUrl),
        formActionUrl: this.optionalString(payload.formActionUrl),
        cookieJar: CookieJar.fromJSON(payload.cookieJar),
        createdAt,
      };
    } catch (error) {
      this.logger.warn('Rejected malformed university validation session from Redis', this.errorMessage(error));
      return undefined;
    }
  }

  private isExpired(session: CaptchaSession): boolean {
    return session.createdAt.getTime() + this.sessionTtlMs <= Date.now();
  }

  private redisKey(sessionId: string): string {
    return `university-validation:session:${sessionId}`;
  }

  private optionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private recordOfStrings(value: unknown): Record<string, string> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }

    const entries = Object.entries(value).filter(([, entry]) => typeof entry === 'string');
    return entries.length === Object.keys(value).length ? Object.fromEntries(entries) : undefined;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const parsed = Number.parseInt(this.configService.get<string>(name) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
