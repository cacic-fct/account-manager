import { Injectable, Logger } from '@nestjs/common';
import { CaptchaSession, ValidationResult } from './university-validation.types';
import { SessionManagementService } from './services/session-management.service';
import { CaptchaManagementService } from './services/captcha-management.service';
import { DocumentValidationService } from './services/document-validation.service';

@Injectable()
export class UniversityValidationService {
  private readonly logger = new Logger(UniversityValidationService.name);

  constructor(
    private readonly sessionManagementService: SessionManagementService,
    private readonly captchaManagementService: CaptchaManagementService,
    private readonly documentValidationService: DocumentValidationService,
  ) {}

  /**
   * Extract authentication code from PDF buffer
   */
  async extractAuthCodeFromPdf(pdfBuffer: Buffer): Promise<string> {
    return this.documentValidationService.extractAuthCodeFromPdf(pdfBuffer);
  }

  /**
   * Extract enrollment number from PDF buffer
   */
  async extractEnrollmentFromPdf(pdfBuffer: Buffer): Promise<string | null> {
    return this.documentValidationService.extractEnrollmentFromPdf(pdfBuffer);
  }

  /**
   * Get captcha for document validation
   */
  async getCaptcha(
    sessionId: string,
    userId: string,
    authCode?: string,
    enrollmentNumber?: string,
  ): Promise<CaptchaSession> {
    return this.captchaManagementService.getCaptcha(sessionId, userId, authCode, enrollmentNumber);
  }

  /**
   * Refresh captcha for existing session
   */
  async refreshCaptcha(sessionId: string, userId: string): Promise<CaptchaSession> {
    return this.captchaManagementService.refreshCaptcha(sessionId, userId);
  }

  /**
   * Main document validation method
   */
  async validateDocument(
    sessionId: string,
    enrollmentNumber: string,
    captchaCode: string,
    userId: string,
  ): Promise<ValidationResult> {
    return this.captchaManagementService.validateDocument(sessionId, enrollmentNumber, captchaCode, userId);
  }

  /**
   * Clean up old sessions periodically
   */
  cleanupOldSessions(): void {
    this.sessionManagementService.cleanupOldSessions();
  }

  /**
   * Get enrollment number from session
   */
  getEnrollmentFromSession(sessionId: string, userId: string): string | undefined {
    this.logger.debug('Retrieving enrollment from owned university validation session');

    const session = this.captchaManagementService.getSession(sessionId, userId);
    if (!session) {
      this.logger.error('University validation session not found');
      throw new Error('Session not found');
    }

    this.logger.debug('University validation session found and authorized', {
      hasEnrollmentNumber: !!session.enrollmentNumber,
    });
    return session.enrollmentNumber;
  }

  /**
   * Get auth code from session
   */
  getAuthCodeFromSession(sessionId: string, userId: string): string {
    this.logger.debug('Retrieving authentication code from owned university validation session');

    const session = this.captchaManagementService.getSession(sessionId, userId);
    if (!session) {
      this.logger.error('University validation session not found');
      throw new Error('Session not found');
    }

    if (!session.authCode) {
      this.logger.error('Authentication code not found in university validation session');
      throw new Error('Auth code not found in session');
    }

    this.logger.debug('Authentication code found in university validation session');
    return session.authCode;
  }

  /**
   * Clear session with security check
   */
  clearSession(sessionId: string, userId: string): void {
    this.captchaManagementService.clearSession(sessionId, userId);
    this.logger.debug('University validation session cleared');
  }
}
