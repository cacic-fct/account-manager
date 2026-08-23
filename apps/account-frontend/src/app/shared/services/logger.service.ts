import { Service, isDevMode, inject } from '@angular/core';
import { ErrorTrackingService } from './error-tracking.service';

/**
 * Centralized logging service that only logs in development mode
 * Prevents console pollution in production
 */
@Service()
export class LoggerService {
  private readonly isDev = isDevMode();
  private errorTracking = inject(ErrorTrackingService);

  debug(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      console.debug(`[DEBUG] ${message}`, ...args.map((arg) => this.redact(arg)));
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      console.info(`[INFO] ${message}`, ...args.map((arg) => this.redact(arg)));
    }
  }

  warn(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      console.warn(`[WARN] ${message}`, ...args.map((arg) => this.redact(arg)));
    }
    this.errorTracking.trackWarning(message, { args: args.map((arg) => this.redact(arg)) });
  }

  error(message: string, ...args: unknown[]): void {
    const safeArgs = args.map((arg) => this.redact(arg));
    if (this.isDev) {
      console.error(`[ERROR] ${message}`, ...safeArgs);
    }

    // Track error with context
    const error = this.redact(args.find((arg) => arg instanceof Error) || new Error(message));
    const context = safeArgs.filter((arg) => !(arg instanceof Error));
    this.errorTracking.trackError(message, error, { context });
  }

  private redact(value: unknown, seen = new WeakSet<object>()): unknown {
    if (value === null || typeof value !== 'object') {
      return value;
    }

    if (value instanceof Error) {
      return { name: value.name, status: (value as Error & { status?: unknown }).status };
    }

    if (seen.has(value)) {
      return '[Circular]';
    }
    seen.add(value);

    if (Array.isArray(value)) {
      return value.map((item) => this.redact(item, seen));
    }

    const result: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      if (this.isSensitiveKey(key)) {
        result[key] = '[REDACTED]';
      } else {
        result[key] = this.redact(item, seen);
      }
    }
    return result;
  }

  private isSensitiveKey(key: string): boolean {
    return /^(email|phone|fullname|fullName|displayName|identityDocument|passportCountry|picture|profile|currentUser|user)$/i.test(
      key,
    );
  }
}
