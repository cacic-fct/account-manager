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
      console.debug(`[DEBUG] ${message}`, ...args);
    }
  }

  info(message: string, ...args: unknown[]): void {
    if (this.isDev) {
      console.info(`[INFO] ${message}`, ...args);
    }
  }

  warn(message: string, ...args: unknown[]): void {
    console.warn(`[WARN] ${message}`, ...args);
    this.errorTracking.trackWarning(message, { args });
  }

  error(message: string, ...args: unknown[]): void {
    console.error(`[ERROR] ${message}`, ...args);

    // Track error with context
    const error = args.find((arg) => arg instanceof Error) || new Error(message);
    const context = args.filter((arg) => !(arg instanceof Error));
    this.errorTracking.trackError(message, error, { context });
  }
}
