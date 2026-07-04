import { Injectable, Logger } from '@nestjs/common';
import { StudentVerificationService } from '../../student-verification/student-verification.service';

@Injectable()
export class NetworkErrorService {
  private readonly logger = new Logger(NetworkErrorService.name);

  constructor(private readonly studentVerificationService: StudentVerificationService) {}

  /**
   * Check if error is a network-related error that should trigger manual fallback
   */
  isNetworkError(error: unknown): boolean {
    this.logger.debug('isNetworkError: Checking error', {
      errorType: typeof error,
      errorConstructor: error?.constructor?.name,
      isObject: typeof error === 'object',
    });

    if (!error || typeof error !== 'object') {
      this.logger.debug('isNetworkError: Not an object, returning false');
      return false;
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const err = error as any; // Use any for more flexible property access

    // Extract error details from multiple possible locations
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
    const errorMessage = String(err.message || err.toString() || '');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const errorCode = String(err.code || err.errno || '');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const axiosCode = String(err.response?.status || '');
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const syscall = String(err.syscall || '');

    // Check if it's an AxiosError specifically
    const isAxiosError =
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      err.isAxiosError === true ||
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      err.name === 'AxiosError' ||
      errorMessage.includes('AxiosError');

    this.logger.debug('isNetworkError: Extracted error details', {
      errorMessage,
      errorCode,
      axiosCode,
      syscall,
      isAxiosError,
      messageLength: errorMessage.length,
      codeLength: errorCode.length,
      // Log more axios-specific properties
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      hasResponse: !!err.response,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      hasRequest: !!err.request,
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-assignment
      axiosMessage: err.response?.statusText,
    });

    // Network connectivity errors
    const networkErrorCodes = [
      'ENOTFOUND', // DNS resolution failed
      'ECONNREFUSED', // Connection refused
      'ECONNRESET', // Connection reset
      'ETIMEDOUT', // Connection timeout
      'ECONNABORTED', // Connection aborted
      'ENETUNREACH', // Network unreachable
      'EHOSTUNREACH', // Host unreachable
    ];

    // Check error codes in multiple places
    const codeMatch = networkErrorCodes.find((code) => errorCode.includes(code) || syscall.includes(code));
    if (codeMatch) {
      this.logger.debug(`isNetworkError: Found matching code: ${codeMatch}`);
      return true;
    }

    // Check error messages for network-related issues
    const networkErrorMessages = [
      'getaddrinfo ENOTFOUND',
      'connect ECONNREFUSED',
      'connect ETIMEDOUT',
      'socket hang up',
      'network timeout',
      'request timeout',
      'ENOTFOUND', // Also check for plain error codes in message
    ];

    const messageMatch = networkErrorMessages.find((msg) => errorMessage.toLowerCase().includes(msg.toLowerCase()));

    if (messageMatch) {
      this.logger.debug(`isNetworkError: Found matching message: ${messageMatch}`);
      return true;
    }

    // Special check for Axios network errors without response
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    if (isAxiosError && !err.response && err.request) {
      this.logger.debug('isNetworkError: AxiosError with request but no response - likely network error');
      return true;
    }

    this.logger.debug('isNetworkError: No network error patterns matched, returning false');
    return false;
  }

  /**
   * Create manual fallback document for network errors
   */
  async createNetworkErrorFallback(
    userId: string,
    sessionId: string,
    authCode?: string,
    enrollmentNumber?: string,
    captchaCode?: string,
    error?: unknown,
    reason = 'Network error',
  ): Promise<{ documentId: string }> {
    const errorObj = error as { message?: string; code?: string };
    const fallbackDocument = {
      buffer: Buffer.from(
        `Auth Code: ${authCode || 'N/A'}\n` +
          `Enrollment: ${enrollmentNumber || 'N/A'}\n` +
          `Captcha Code: ${captchaCode || 'N/A'}\n` +
          `Reason: ${reason}\n` +
          `Error: ${errorObj?.message || 'Unknown error'}\n` +
          `Error Code: ${errorObj?.code || 'UNKNOWN'}\n` +
          `Timestamp: ${new Date().toISOString()}`,
      ),
      originalname: `network-error-fallback-${sessionId}.txt`,
      mimetype: 'text/plain',
    } as Express.Multer.File;

    const manualApprovalResult = await this.studentVerificationService.uploadDocument(
      fallbackDocument,
      userId,
      true, // isManualFallback flag
    );

    this.logger.log('Successfully created manual fallback for network error', {
      sessionId,
      userId,
      documentId: manualApprovalResult.documentId,
    });

    return manualApprovalResult;
  }
}
