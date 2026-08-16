import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type ExternalVerificationUnavailableReason = 'disabled' | 'circuit_open' | 'overloaded' | 'upstream_failure';

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
  private readonly maxConcurrentRequests: number;
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;
  private inFlightRequests = 0;
  private halfOpenProbeInFlight = false;
  private failureVersion = 0;

  constructor(private readonly configService: ConfigService) {
    this.enabled = this.readBoolean('UNIVERSITY_EXTERNAL_VERIFICATION_ENABLED', true);
    this.timeoutMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_TIMEOUT_MS', 10_000);
    this.maxResponseBytes = this.readPositiveInteger('UNIVERSITY_EXTERNAL_MAX_RESPONSE_BYTES', 12 * 1024 * 1024);
    this.failureThreshold = this.readPositiveInteger('UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD', 3);
    this.circuitResetMs = this.readPositiveInteger('UNIVERSITY_EXTERNAL_CIRCUIT_RESET_MS', 5 * 60 * 1000);
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
    const isHalfOpenProbe = this.circuitOpenUntil > 0;
    if (isHalfOpenProbe) {
      this.halfOpenProbeInFlight = true;
    }
    const failureVersionAtStart = this.failureVersion;
    this.inFlightRequests += 1;

    try {
      const result = await task();
      this.recordSuccess(failureVersionAtStart);
      return result;
    } catch (error) {
      if (error instanceof ExternalVerificationUnavailableError) {
        throw error;
      }

      this.recordFailure(operation, error);
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

  private recordSuccess(failureVersionAtStart: number): void {
    if (failureVersionAtStart !== this.failureVersion) {
      return;
    }
    if (this.consecutiveFailures > 0 || this.circuitOpenUntil > 0) {
      this.logger.log('External university verification recovered');
    }

    this.consecutiveFailures = 0;
    this.circuitOpenUntil = 0;
  }

  private recordFailure(operation: string, error: unknown): void {
    this.failureVersion += 1;
    this.consecutiveFailures += 1;
    this.logger.warn('External university verification request failed', {
      operation,
      consecutiveFailures: this.consecutiveFailures,
      errorType: error instanceof Error ? error.name : typeof error,
    });

    if (this.consecutiveFailures < this.failureThreshold) {
      return;
    }

    this.circuitOpenUntil = Date.now() + this.circuitResetMs;
    this.logger.error('External university verification circuit opened', {
      operation,
      retryAfterMs: this.circuitResetMs,
    });
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
