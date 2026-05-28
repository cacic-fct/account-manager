import { Injectable } from '@nestjs/common';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';

/**
 * Service for CSRF token generation and validation
 * Implements double-submit cookie pattern for CSRF protection
 */
@Injectable()
export class CsrfService {
  /**
   * Generates a cryptographically secure CSRF token
   * @returns A hex-encoded random token
   */
  generateToken(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Validates a CSRF token against the session token using constant-time comparison
   * @param tokenFromRequest - Token received from the request (header or body)
   * @param tokenFromSession - Token stored in the session
   * @returns true if tokens match, false otherwise
   */
  validateToken(tokenFromRequest: string, tokenFromSession: string): boolean {
    if (!tokenFromRequest || !tokenFromSession) {
      return false;
    }

    try {
      const bufferRequest = Buffer.from(tokenFromRequest, 'utf-8');
      const bufferSession = Buffer.from(tokenFromSession, 'utf-8');

      // If lengths differ, still perform a comparison to prevent timing attacks
      if (bufferRequest.length !== bufferSession.length) {
        timingSafeEqual(bufferRequest, bufferRequest);
        return false;
      }

      return timingSafeEqual(bufferRequest, bufferSession);
    } catch {
      return false;
    }
  }

  /**
   * Creates a hash of the token for additional security
   * @param token - The token to hash
   * @returns SHA-256 hash of the token
   */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
