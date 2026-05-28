import { Injectable } from '@nestjs/common';

/**
 * Simple in-memory rate limiting service
 * For production, this should be moved to Redis or a dedicated rate limiting service
 */
@Injectable()
export class RateLimitService {
  private readonly requests = new Map<string, number[]>();
  private readonly maxRequests = 10; // Max requests per window
  private readonly windowMs = 60000; // 1 minute window

  /**
   * Check if a user/IP is within rate limits
   * @param identifier User ID or IP address
   * @returns true if within limits, false if rate limited
   */
  isWithinLimits(identifier: string): boolean {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];

    // Remove old requests outside the time window
    const recentRequests = requests.filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    // Check if within limits
    if (recentRequests.length >= this.maxRequests) {
      return false;
    }

    // Add current request
    recentRequests.push(now);
    this.requests.set(identifier, recentRequests);

    return true;
  }

  /**
   * Get remaining requests for identifier
   */
  getRemainingRequests(identifier: string): number {
    const now = Date.now();
    const requests = this.requests.get(identifier) || [];
    const recentRequests = requests.filter(
      (timestamp) => now - timestamp < this.windowMs,
    );

    return Math.max(0, this.maxRequests - recentRequests.length);
  }

  /**
   * Get time until rate limit reset
   */
  getResetTime(identifier: string): number {
    const requests = this.requests.get(identifier);
    if (!requests || requests.length === 0) {
      return 0;
    }

    const oldestRequest = Math.min(...requests);
    const resetTime = oldestRequest + this.windowMs - Date.now();

    return Math.max(0, resetTime);
  }

  /**
   * Clear rate limit data for identifier
   */
  clearLimits(identifier: string): void {
    this.requests.delete(identifier);
  }

  /**
   * Cleanup expired entries (should be called periodically)
   */
  cleanup(): void {
    const now = Date.now();

    for (const [identifier, requests] of this.requests.entries()) {
      const recentRequests = requests.filter(
        (timestamp) => now - timestamp < this.windowMs,
      );

      if (recentRequests.length === 0) {
        this.requests.delete(identifier);
      } else {
        this.requests.set(identifier, recentRequests);
      }
    }
  }
}
