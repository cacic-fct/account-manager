import { Service } from '@angular/core';
import { isDevMode } from '@angular/core';

export interface ErrorContext {
  component?: string;
  method?: string;
  userId?: string;
  timestamp?: Date;
  [key: string]: unknown;
}

export interface ErrorLog {
  message: string;
  error: unknown;
  context: ErrorContext;
  timestamp: Date;
  severity: 'error' | 'warning' | 'critical';
}

@Service()
export class ErrorTrackingService {
  private errorLog: ErrorLog[] = [];
  private readonly MAX_LOG_SIZE = 100;

  /**
   * Track an error with context
   */
  trackError(
    message: string,
    error: unknown,
    context: ErrorContext = {},
    severity: 'error' | 'warning' | 'critical' = 'error',
  ): void {
    const errorLog: ErrorLog = {
      message,
      error,
      context: {
        ...context,
        timestamp: new Date(),
      },
      timestamp: new Date(),
      severity,
    };

    // Add to in-memory log
    this.errorLog.unshift(errorLog);

    // Keep log size manageable
    if (this.errorLog.length > this.MAX_LOG_SIZE) {
      this.errorLog = this.errorLog.slice(0, this.MAX_LOG_SIZE);
    }

    // Log to console in dev mode
    if (isDevMode()) {
      const errorObj = error instanceof Error ? error : new Error(String(error));
      console.error(`[ErrorTracking] ${severity.toUpperCase()}: ${message}`, {
        context,
        error: errorObj,
        stack: errorObj.stack,
      });
    }

    // In production, you would send to error tracking service
    // Example: Sentry, LogRocket, etc.
    if (!isDevMode() && severity === 'critical') {
      // this.sendToErrorTrackingService(errorLog);
    }
  }

  /**
   * Track a warning
   */
  trackWarning(message: string, context: ErrorContext = {}): void {
    this.trackError(message, new Error(message), context, 'warning');
  }

  /**
   * Track a critical error that needs immediate attention
   */
  trackCritical(message: string, error: unknown, context: ErrorContext = {}): void {
    this.trackError(message, error, context, 'critical');
  }

  /**
   * Get recent errors for debugging
   */
  getRecentErrors(limit = 10): ErrorLog[] {
    return this.errorLog.slice(0, limit);
  }

  /**
   * Get errors by severity
   */
  getErrorsBySeverity(severity: 'error' | 'warning' | 'critical'): ErrorLog[] {
    return this.errorLog.filter((log) => log.severity === severity);
  }

  /**
   * Clear error log
   */
  clearErrors(): void {
    this.errorLog = [];
  }

  /**
   * Export errors as JSON (for debugging or reporting)
   */
  exportErrors(): string {
    return JSON.stringify(
      this.errorLog.map((log) => ({
        ...log,
        error: log.error instanceof Error ? { message: log.error.message, stack: log.error.stack } : log.error,
      })),
      null,
      2,
    );
  }

  // Future: Send to external error tracking service
  // private sendToErrorTrackingService(errorLog: ErrorLog): void {
  //   // Implementation for Glitchtip
  // }
}
