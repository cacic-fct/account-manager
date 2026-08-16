import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { CookieJar } from 'tough-cookie';
import { CaptchaSession } from '../university-validation.types';

@Injectable()
export class SessionManagementService {
  private readonly logger = new Logger(SessionManagementService.name);
  public readonly sessions = new Map<string, CaptchaSession>();
  private readonly sessionTtlMs: number;
  private readonly maxSessions: number;

  constructor(private readonly configService: ConfigService) {
    this.sessionTtlMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_SESSION_TTL_MS', 15 * 60 * 1000);
    this.maxSessions = this.readPositiveInteger('UNIVERSITY_EXTERNAL_MAX_SESSIONS', 500);
  }

  createSession(sessionId: string): CaptchaSession {
    const session: CaptchaSession = {
      sessionId,
      cookieJar: new CookieJar(),
      createdAt: new Date(),
    };

    this.storeSession(session);
    this.logger.debug('Created university validation session');
    return session;
  }

  getSession(sessionId: string): CaptchaSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && this.isExpired(session)) {
      this.deleteSession(sessionId);
      return undefined;
    }

    return session;
  }

  getOwnedSession(sessionId: string, userId: string): CaptchaSession | undefined {
    const session = this.getSession(sessionId);
    return session?.userId === userId ? session : undefined;
  }

  storeSession(session: CaptchaSession): void {
    this.cleanupOldSessions();

    if (!this.sessions.has(session.sessionId) && this.sessions.size >= this.maxSessions) {
      const oldestSessionId = this.sessions.keys().next().value;
      if (oldestSessionId) {
        this.deleteSession(oldestSessionId);
        this.logger.warn('Evicted oldest university validation session after reaching the session limit');
      }
    }

    this.sessions.set(session.sessionId, session);
  }

  deleteSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.authCode = undefined;
      session.enrollmentNumber = undefined;
      session.captchaImageBase64 = undefined;
      session.hiddenInputs = undefined;
      session.formActionUrl = undefined;
      session.pageUrl = undefined;
      session.axiosInstance = undefined;
      session.cookieJar = new CookieJar();
    }
    this.sessions.delete(sessionId);
    this.logger.debug('Deleted university validation session');
  }

  @Interval(60_000)
  cleanupOldSessions(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (this.isExpired(session)) {
        this.deleteSession(sessionId);
      }
    }
  }

  private isExpired(session: CaptchaSession): boolean {
    return session.createdAt.getTime() + this.sessionTtlMs <= Date.now();
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const parsed = Number.parseInt(this.configService.get<string>(name) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
