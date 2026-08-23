import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

export type ExternalVerificationUnavailableReason =
  'disabled' | 'circuit_open' | 'overloaded' | 'upstream_failure' | 'state_unavailable';

export class ExternalVerificationUnavailableError extends Error {
  constructor(
    readonly reason: ExternalVerificationUnavailableReason,
    options?: ErrorOptions,
  ) {
    super('External university verification is temporarily unavailable', options);
    this.name = ExternalVerificationUnavailableError.name;
  }
}

@Injectable()
export class ExternalVerificationResilienceService {
  private readonly logger = new Logger(ExternalVerificationResilienceService.name);
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
  private readonly enabled: boolean;
  private readonly failureThreshold: number;
  private readonly circuitResetMs: number;
  private readonly circuitResetSeconds: number;
  private readonly probeTtlSeconds: number;
  private readonly maxConcurrentRequests: number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private inFlightRequests = 0;
  private halfOpenProbeInFlight = false;
  private failureVersion = 0;

  constructor(
    private readonly configService: ConfigService,
    private readonly redis: RedisService,
  ) {
    this.enabled = this.readBoolean('UNIVERSITY_EXTERNAL_VERIFICATION_ENABLED', true);
    this.timeoutMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_TIMEOUT_MS', 10_000);
    this.maxResponseBytes = this.readPositiveInteger('UNIVERSITY_EXTERNAL_MAX_RESPONSE_BYTES', 12 * 1024 * 1024);
    this.failureThreshold = this.readPositiveInteger('UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD', 3);
    this.circuitResetMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_CIRCUIT_RESET_MS', 5 * 60 * 1000);
    this.circuitResetSeconds = Math.max(1, Math.ceil(this.circuitResetMs / 1000));
    this.probeTtlSeconds = Math.max(1, Math.ceil(this.timeoutMs / 1000));
    this.maxConcurrentRequests = this.readPositiveInteger('UNIVERSITY_EXTERNAL_MAX_CONCURRENT_REQUESTS', 10);
  }

  getStatus(): {
    enabled: boolean;
    state: 'disabled' | 'open' | 'half_open' | 'overloaded' | 'available';
    inFlightRequests: number;
    retryAfterMs: number;
  } {
    const retryAfterMs = Math.max(0, this.circuitOpenUntil - Date.now());
    const state = !this.enabled
      ? 'disabled'
      : retryAfterMs > 0
        ? 'open'
        : this.halfOpenProbeInFlight
          ? 'half_open'
          : this.inFlightRequests >= this.maxConcurrentRequests
            ? 'overloaded'
            : 'available';
    return {
      enabled: this.enabled,
      state,
      inFlightRequests: this.inFlightRequests,
      retryAfterMs,
    };
  }

  assertAvailable(): void {
    if (!this.enabled) {
      throw new ExternalVerificationUnavailableError('disabled');
    }

    if (this.circuitOpenUntil > Date.now()) {
      throw new ExternalVerificationUnavailableError('circuit_open');
    }

    if (this.circuitOpenUntil > 0 && this.halfOpenProbeInFlight) {
      throw new ExternalVerificationUnavailableError('circuit_open');
    }

    if (this.inFlightRequests >= this.maxConcurrentRequests) {
      throw new ExternalVerificationUnavailableError('overloaded');
    }
  }

  async execute<T>(operation: string, task: () => Promise<T>): Promise<T> {
    this.assertAvailable();
    const isHalfOpenProbe = await this.acquireDistributedCircuitSlot();
    if (isHalfOpenProbe) {
      this.halfOpenProbeInFlight = true;
    }
    const failureVersionAtStart = this.failureVersion;
    this.inFlightRequests += 1;

    try {
      const result = await task();
      await this.recordSuccess(failureVersionAtStart, isHalfOpenProbe);
      return result;
    } catch (error) {
      if (error instanceof ExternalVerificationUnavailableError) {
        throw error;
      }

      await this.recordFailure(operation, error);
      throw new ExternalVerificationUnavailableError('upstream_failure', {
        cause: error,
      });
    } finally {
      this.inFlightRequests -= 1;
      if (isHalfOpenProbe) {
        this.halfOpenProbeInFlight = false;
      }
    }
  }

  async getDistributedStatus(): Promise<{
    state: 'open' | 'half_open' | 'available';
    retryAfterMs: number;
  }> {
    if (!this.enabled) {
      return { state: 'available', retryAfterMs: 0 };
    }

    try {
      const open = await this.redis.get(this.circuitOpenKey());
      if (open) {
        const ttl = await this.redis.ttl(this.circuitOpenKey());
        return { state: 'open', retryAfterMs: Math.max(0, ttl * 1000) };
      }

      const halfOpen = await this.redis.get(this.circuitEpochKey());
      return { state: halfOpen ? 'half_open' : 'available', retryAfterMs: 0 };
    } catch (error) {
      this.logger.error('Unable to read distributed university verification circuit state', this.errorMessage(error));
      return { state: 'open', retryAfterMs: this.circuitResetMs };
    }
  }

  private async recordSuccess(failureVersionAtStart: number, isHalfOpenProbe: boolean): Promise<void> {
    if (failureVersionAtStart !== this.failureVersion) {
      return;
    }
    if (this.consecutiveFailures > 0 || this.circuitOpenUntil > 0) {
      this.logger.log('External university verification recovered');
    }

    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;

    try {
      if (isHalfOpenProbe) {
        await Promise.all([
          this.redis.del(this.circuitFailureKey()),
          this.redis.del(this.circuitOpenKey()),
          this.redis.del(this.circuitEpochKey()),
          this.redis.del(this.circuitProbeKey()),
        ]);
      } else if (!(await this.redis.get(this.circuitOpenKey()))) {
        await this.redis.del(this.circuitFailureKey());
      }
    } catch (error) {
      // A successful upstream request must not make the next request fail
      // open. The distributed circuit remains bounded by its existing TTL.
      this.logger.warn('Unable to clear distributed university verification circuit state', this.errorMessage(error));
    }
  }

  private async recordFailure(operation: string, error: unknown): Promise<void> {
    this.failureVersion += 1;
    this.consecutiveFailures += 1;
    this.logger.warn('External university verification request failed', {
      operation,
      consecutiveFailures: this.consecutiveFailures,
      errorType: error instanceof Error ? error.name : typeof error,
    });

    let distributedFailures: number;
    try {
      distributedFailures = await this.redis.incrementWithExpiry(this.circuitFailureKey(), this.circuitResetSeconds);
    } catch (redisError) {
      // Do not fail open when the shared breaker cannot be updated. A local
      // bounded open interval protects this replica until Redis recovers.
      this.circuitOpenUntil = Date.now() + this.circuitResetMs;
      this.logger.error(
        'Unable to update distributed university verification circuit state',
        this.errorMessage(redisError),
      );
      return;
    }

    if (this.consecutiveFailures < this.failureThreshold && distributedFailures < this.failureThreshold) {
      return;
    }

    this.circuitOpenUntil = Date.now() + this.circuitResetMs;
    this.logger.error('External university verification circuit opened', {
      operation,
      retryAfterMs: this.circuitResetMs,
    });

    try {
      await Promise.all([
        this.redis.set(this.circuitOpenKey(), '1', this.circuitResetSeconds),
        this.redis.set(this.circuitEpochKey(), '1', this.circuitResetSeconds + this.probeTtlSeconds),
      ]);
    } catch (redisError) {
      this.logger.error(
        'Unable to persist distributed university verification circuit state',
        this.errorMessage(redisError),
      );
    }
  }

  private async acquireDistributedCircuitSlot(): Promise<boolean> {
    try {
      if (await this.redis.get(this.circuitOpenKey())) {
        throw new ExternalVerificationUnavailableError('circuit_open');
      }

      if (!(await this.redis.get(this.circuitEpochKey()))) {
        return false;
      }

      const acquired = await this.redis.setIfAbsent(
        this.circuitProbeKey(),
        `${process.pid}:${Date.now()}`,
        this.probeTtlSeconds,
      );
      if (!acquired) {
        throw new ExternalVerificationUnavailableError('circuit_open');
      }
      return true;
    } catch (error) {
      if (error instanceof ExternalVerificationUnavailableError) {
        throw error;
      }
      this.logger.error('Unable to read distributed university verification circuit state', this.errorMessage(error));
      throw new ExternalVerificationUnavailableError('state_unavailable', { cause: error });
    }
  }

  private circuitFailureKey(): string {
    return 'university-validation:circuit:failures';
  }

  private circuitOpenKey(): string {
    return 'university-validation:circuit:open';
  }

  private circuitEpochKey(): string {
    return 'university-validation:circuit:epoch';
  }

  private circuitProbeKey(): string {
    return 'university-validation:circuit:probe';
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
  }

  private readBoolean(name: string, fallback: boolean): boolean {
    const value = this.configService.get<string>(name);
    if (value === undefined) {
      return fallback;
    }

    return !['false', '0', 'no', 'off'].includes(value.trim().toLowerCase());
  }

  private readPositiveInteger(name: string, fallback: number): number {
    const parsed = Number.parseInt(this.configService.get<string>(name) ?? '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  }
}
