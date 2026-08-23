import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GLOBAL_FEATURE_FLAGS } from './feature-flags.constants';
import { RedisService } from '../redis/redis.service';

const DEFAULT_UNLEASH_FRONTEND_URL = 'https://unleash.cacic.com.br/api/frontend';
const DEFAULT_UNLEASH_CLIENT_KEYS = {
  development: 'default:development.rUPorLb0LVO4VIBLZ5RX4TKvsvGuABYmpkmzpWa7QHXwqSZ20v0ppRGYCWAO',
  production: 'default:production.h8sn3hzUSF07msdHkuXubAVRxSgtAdGsBCXiXXhcs8I4boeXozEue0Tx0lwq',
} as const;

interface CachedBooleanFlag {
  value: boolean;
  expiresAt: number;
}

@Injectable()
export class FeatureFlagService {
  private readonly logger = new Logger(FeatureFlagService.name);
  private readonly cache = new Map<string, CachedBooleanFlag>();
  private readonly inFlight = new Map<string, Promise<boolean>>();
  private readonly cacheTtlMs!: number;
  private readonly timeoutMs!: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.cacheTtlMs = this.parsePositiveInteger(this.configService.get<string>('UNLEASH_CACHE_TTL_MS'), 60_000);
    this.timeoutMs = this.parsePositiveInteger(this.configService.get<string>('UNLEASH_TIMEOUT_MS'), 2_500);
  }

  async isUndergraduateUnespRoleVerificationDisabled(): Promise<boolean> {
    return this.isEnabled(GLOBAL_FEATURE_FLAGS.undergraduateUnespRoleVerificationDisabled, false);
  }

  async isEnabled(flagName: string, fallback: boolean): Promise<boolean> {
    const cached = this.cache.get(flagName);
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }

    const distributed = await this.readDistributedFlag(flagName);
    if (distributed) {
      this.cache.set(flagName, distributed);
      return distributed.value;
    }

    const activeRequest = this.inFlight.get(flagName);
    if (activeRequest) {
      return activeRequest;
    }

    const request = this.fetchFlagValue(flagName, fallback)
      .then(async (value) => {
        const entry = {
          value,
          expiresAt: Date.now() + this.cacheTtlMs,
        };
        this.cache.set(flagName, entry);
        try {
          await this.redis.set(
            this.distributedCacheKey(flagName),
            JSON.stringify(entry),
            Math.ceil(this.cacheTtlMs / 1000),
          );
        } catch (error) {
          this.logger.warn('Unable to publish shared feature-flag snapshot', {
            flagName,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        return value;
      })
      .catch((error: unknown) => {
        this.logger.warn('Unable to read Unleash feature flag', {
          flagName,
          error: error instanceof Error ? error.message : String(error),
        });
        return fallback;
      })
      .finally(() => {
        this.inFlight.delete(flagName);
      });
    this.inFlight.set(flagName, request);
    return request;
  }

  private async fetchFlagValue(flagName: string, fallback: boolean): Promise<boolean> {
    const clientKey = this.readClientKey();
    if (!clientKey) {
      return fallback;
    }

    const response = await fetch(this.readFrontendUrl(), {
      headers: {
        Authorization: clientKey,
        'UNLEASH-APPNAME': this.readAppName(),
        'UNLEASH-ENVIRONMENT': this.readEnvironment(),
      },
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}`);
    }

    return this.readToggleValue(await response.json(), flagName) ?? fallback;
  }

  private readToggleValue(payload: unknown, flagName: string): boolean | null {
    for (const toggle of this.readToggleList(payload)) {
      if (!this.isRecord(toggle)) {
        continue;
      }

      if (toggle['name'] === flagName && typeof toggle['enabled'] === 'boolean') {
        return toggle['enabled'];
      }
    }

    return null;
  }

  private readToggleList(payload: unknown): unknown[] {
    if (Array.isArray(payload)) {
      return payload;
    }

    if (!this.isRecord(payload)) {
      return [];
    }

    const toggles = payload['toggles'];
    if (Array.isArray(toggles)) {
      return toggles;
    }

    const features = payload['features'];
    return Array.isArray(features) ? features : [];
  }

  private readFrontendUrl(): string {
    return (
      this.configService.get<string>('UNLEASH_FRONTEND_API_URL') ||
      this.configService.get<string>('UNLEASH_API_URL') ||
      DEFAULT_UNLEASH_FRONTEND_URL
    );
  }

  private readClientKey(): string {
    const configured =
      this.configService.get<string>('UNLEASH_FRONTEND_CLIENT_KEY') ||
      this.configService.get<string>('UNLEASH_CLIENT_KEY');
    if (configured?.trim()) {
      return configured.trim();
    }

    return this.readEnvironment() === 'production'
      ? DEFAULT_UNLEASH_CLIENT_KEYS.production
      : DEFAULT_UNLEASH_CLIENT_KEYS.development;
  }

  private readAppName(): string {
    return this.configService.get<string>('UNLEASH_APP_NAME') || 'account-manager-backend';
  }

  private readEnvironment(): 'development' | 'production' {
    const configured =
      this.configService.get<string>('UNLEASH_ENVIRONMENT') || this.configService.get<string>('NODE_ENV');

    return configured === 'production' ? 'production' : 'development';
  }

  private parsePositiveInteger(value: string | undefined, fallback: number) {
    if (!value || !/^\d+$/.test(value)) {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }

  private async readDistributedFlag(flagName: string): Promise<CachedBooleanFlag | null> {
    try {
      const raw = await this.redis.get(this.distributedCacheKey(flagName));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as unknown;
      if (
        this.isRecord(parsed) &&
        typeof parsed['value'] === 'boolean' &&
        typeof parsed['expiresAt'] === 'number' &&
        parsed['expiresAt'] > Date.now()
      ) {
        return { value: parsed['value'], expiresAt: parsed['expiresAt'] };
      }
      return null;
    } catch (error) {
      this.logger.warn('Unable to read shared feature-flag snapshot', {
        flagName,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  private distributedCacheKey(flagName: string): string {
    return `feature-flags:snapshot:${flagName}`;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }
}
