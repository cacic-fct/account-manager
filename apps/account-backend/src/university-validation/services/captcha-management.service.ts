import { Injectable, Logger } from '@nestjs/common';
import { CaptchaSession, ValidationResult } from '../university-validation.types';
import { StudentVerificationService } from '../../student-verification/student-verification.service';
import { SessionManagementService } from './session-management.service';
import { S3Service } from '../../common/services/s3.service';
import { NetworkErrorService } from './network-error.service';
import { HtmlResponseService } from './html-response.service';
import { DocumentValidationService } from './document-validation.service';

@Injectable()
export class CaptchaManagementService {
  private readonly logger = new Logger(CaptchaManagementService.name);

  // Add sessions Map to maintain compatibility
  private readonly sessions = new Map<string, CaptchaSession>();

  constructor(
    private readonly studentVerificationService: StudentVerificationService,
    private readonly sessionManagementService: SessionManagementService,
    private readonly s3Service: S3Service,
    private readonly networkErrorService: NetworkErrorService,
    private readonly htmlResponseService: HtmlResponseService,
    private readonly documentValidationService: DocumentValidationService,
  ) {}

  /**
   * Get captcha for document validation
   */
  async getCaptcha(
    sessionId: string,
    userId: string,
    authCode?: string,
    enrollmentNumber?: string,
  ): Promise<CaptchaSession> {
    this.logger.debug(
      `Getting captcha for session ${sessionId} (user: ${userId}) with authCode ${authCode ? 'present' : 'missing'} and enrollment ${enrollmentNumber || 'not provided'}`,
    );

    try {
      // Import required modules
      const axios = await import('axios');
      const cheerio = await import('cheerio');
      const { CookieJar } = await import('tough-cookie');

      const cookieJar = new CookieJar();
      const documentUrl = 'https://sistemas.unesp.br/academico/publico/documento.action';
      const captchaUrl = 'https://sistemas.unesp.br/academico/captcha.jpg';

      const axiosInstance = axios.default.create({
        timeout: 30000,
        withCredentials: true,
        headers: {
          'User-Agent':
            // 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Mozilla/5.0 (compatible; Cacicbot/1.0; +https://cacic.com.br)',
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
          'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
          'Accept-Encoding': 'gzip, deflate, br',
          Connection: 'keep-alive',
          'Upgrade-Insecure-Requests': '1',
        },
      });

      // Create session object
      const session: CaptchaSession = {
        sessionId,
        userId,
        cookieJar: cookieJar,
        axiosInstance,
        authCode,
        enrollmentNumber,
        createdAt: new Date(),
      };

      // Access the form page to establish session
      this.logger.debug(`Accessing document form page: ${documentUrl}`);
      const pageResponse = await axiosInstance.get(documentUrl);

      if (pageResponse.status !== 200) {
        throw new Error(`Failed to access document page: ${pageResponse.status}`);
      }

      // Extract cookies from response
      const setCookieHeaders = pageResponse.headers['set-cookie'];
      if (setCookieHeaders) {
        for (const cookie of setCookieHeaders) {
          try {
            await cookieJar.setCookie(cookie, documentUrl);
          } catch (cookieError) {
            this.logger.debug('Failed to set cookie:', cookieError);
          }
        }
      }

      // Parse the HTML to extract hidden form inputs
      const $ = cheerio.load(pageResponse.data as string);
      const hiddenInputs: Record<string, string> = {};
      $('input[type="hidden"]').each((_, element) => {
        const name = $(element).attr('name');
        const value = $(element).attr('value');
        if (name && value) {
          hiddenInputs[name] = value;
        }
      });

      // Check for critical form inputs that are necessary for submission
      const pageHtml = pageResponse.data as string;

      // Look for specific authentication code input field
      const hasAuthCodeInput = $('input[name="txt_codigo_autenticidade"]').length > 0;

      // Look for specific captcha input field
      const hasCaptchaInput = $('input[name="txt_codigo_captcha"]').length > 0;

      if (!hasAuthCodeInput || !hasCaptchaInput) {
        this.logger.error('Essential form input fields missing from Unesp page', {
          pageUrl: documentUrl,
          hasAuthCodeInput,
          hasCaptchaInput,
          pageSize: pageHtml.length,
          pageSnippet: pageHtml.substring(0, 1000),
        });
        throw new Error('UNESP_NETWORK_ERROR: Server appears to be malfunctioning - required form fields missing');
      }

      session.hiddenInputs = hiddenInputs;
      session.pageHtml = pageHtml;
      session.pageUrl = documentUrl;

      // Fetch the captcha image
      this.logger.debug(`Fetching captcha from: ${captchaUrl}`);
      const captchaResponse = await axiosInstance.get(captchaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Cookie: await cookieJar.getCookieString(documentUrl),
          Referer: documentUrl,
        },
      });

      if (captchaResponse.status !== 200) {
        throw new Error(`Failed to fetch captcha: ${captchaResponse.status}`);
      }

      // Convert captcha to base64
      const captchaBuffer = Buffer.from(captchaResponse.data);
      session.captchaImageBase64 = captchaBuffer.toString('base64');

      // Store session in both places to maintain compatibility
      this.sessions.set(sessionId, session);
      this.sessionManagementService.sessions.set(sessionId, session);

      this.logger.debug('Captcha fetched successfully', {
        sessionId,
        captchaSize: captchaBuffer.length,
        hiddenInputsCount: Object.keys(hiddenInputs).length,
      });

      return session;
    } catch (error: unknown) {
      this.logger.error('Error getting captcha:', error);

      // Enhanced debugging for network error detection
      this.logger.debug('Analyzing error for network issues:', {
        errorType: typeof error,
        errorConstructor: error?.constructor?.name,
        isObject: typeof error === 'object',
        errorKeys: error && typeof error === 'object' ? Object.keys(error) : [],
        errorMessage: error instanceof Error ? error.message : String(error),
        errorCode: error && typeof error === 'object' && 'code' in error ? String(error.code) : undefined,
        fullError: JSON.stringify(error, null, 2),
      });

      // Check if this is a network error that should trigger manual fallback
      const isNetworkError = this.networkErrorService.isNetworkError(error);

      this.logger.debug('Network error check result:', {
        isNetworkError,
        sessionId,
        userId,
      });

      if (isNetworkError) {
        this.logger.warn('Network error detected, falling back to manual approval', {
          sessionId,
          userId,
          errorCode: (error as { code?: string })?.code,
          errorMessage: (error as { message?: string })?.message,
        });

        // Create a manual fallback document
        try {
          const manualApprovalResult = await this.networkErrorService.createNetworkErrorFallback(
            userId,
            sessionId,
            authCode,
            enrollmentNumber,
            undefined,
            error,
            'Network error during captcha request',
          );

          // Throw a specific error that the controller can catch and handle
          const networkError = new Error('NETWORK_ERROR_MANUAL_FALLBACK') as Error & {
            fallbackToManual: boolean;
            manualApprovalId: string;
            originalError: unknown;
          };
          networkError.fallbackToManual = true;
          networkError.manualApprovalId = manualApprovalResult.documentId;
          networkError.originalError = error;
          throw networkError;
        } catch (fallbackError) {
          if (fallbackError instanceof Error && fallbackError.message === 'NETWORK_ERROR_MANUAL_FALLBACK') {
            throw fallbackError;
          }

          this.logger.error('Failed to create manual fallback for network error:', fallbackError);
          // Fall through to throw the original error
        }
      }

      throw error;
    }
  }

  /**
   * Refresh captcha for existing session
   */
  async refreshCaptcha(sessionId: string, userId: string): Promise<CaptchaSession> {
    this.logger.debug(`Refreshing captcha for session ${sessionId} (user: ${userId})`);

    try {
      // Get existing session
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = this.sessionManagementService.getSession(sessionId);
      }

      if (!session) {
        throw new Error(`Session not found for sessionId: ${sessionId}`);
      }

      if (!session.axiosInstance) {
        throw new Error(`Session axios instance not found for sessionId: ${sessionId}`);
      }

      const captchaUrl = 'https://sistemas.unesp.br/academico/captcha.jpg';

      // Use existing axios instance and cookies from the session
      const captchaResponse = await session.axiosInstance.get(captchaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Referer: 'https://sistemas.unesp.br/academico/publico/documento.action',
          Cookie: await session.cookieJar.getCookieString(
            'https://sistemas.unesp.br/academico/publico/documento.action',
          ),
        },
      });

      if (captchaResponse.status !== 200) {
        throw new Error(`Failed to fetch new captcha: ${captchaResponse.status}`);
      }

      // Convert new captcha to base64
      const captchaBuffer = Buffer.from(captchaResponse.data);
      session.captchaImageBase64 = captchaBuffer.toString('base64');

      // Update session in both places
      this.sessions.set(sessionId, session);
      this.sessionManagementService.sessions.set(sessionId, session);

      this.logger.debug('Captcha refreshed successfully', {
        sessionId,
        captchaSize: captchaBuffer.length,
      });

      return session;
    } catch (error: unknown) {
      this.logger.error('Error refreshing captcha:', error);

      // Check if this is a network error that should trigger manual fallback
      const isNetworkError = this.networkErrorService.isNetworkError(error);

      if (isNetworkError) {
        this.logger.warn('Network error during captcha refresh, session may need manual fallback', {
          sessionId,
          userId,
          errorCode: (error as { code?: string })?.code,
          errorMessage: (error as { message?: string })?.message,
        });

        // For refresh captcha, we'll throw a specific network error
        // The frontend can handle this appropriately
        const networkError = new Error('CAPTCHA_NETWORK_ERROR') as Error & {
          isNetworkError: boolean;
          originalError: unknown;
        };
        networkError.isNetworkError = true;
        networkError.originalError = error;
        throw networkError;
      }

      throw error;
    }
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
    this.logger.debug('Starting document validation:', {
      sessionId,
      enrollmentNumber,
      userId,
    });

    try {
      // Get session from local storage first, fallback to sessionManagementService
      let session = this.sessions.get(sessionId);
      if (!session) {
        session = this.sessionManagementService.getSession(sessionId);
      }

      if (!session) {
        return {
          success: false,
          error: `Session not found for sessionId: ${sessionId}`,
        };
      }

      // Verify user owns this session for security
      if (session.userId !== userId) {
        return {
          success: false,
          error: 'Unauthorized access to session',
        };
      }

      // Check that we have the required session data
      if (!session.hiddenInputs || !session.pageUrl) {
        this.logger.error('Form data missing from session', {
          hasHiddenInputs: !!session.hiddenInputs,
          hasPageUrl: !!session.pageUrl,
        });
        return {
          success: false,
          error: 'Form data not found in session. Please get captcha first.',
        };
      }

      if (!session.authCode) {
        this.logger.error('Auth code not found in session');
        return {
          success: false,
          error: 'Código de autenticação não encontrado na sessão',
        };
      }

      this.logger.debug('Submitting form with data:', {
        enrollmentNumber,
        captchaCode: captchaCode,
        hasAuthCode: !!session.authCode,
        hasHiddenInputs: !!session.hiddenInputs,
        hiddenInputsCount: session.hiddenInputs ? Object.keys(session.hiddenInputs).length : 0,
      });

      // Build form data using the exact field names from backup
      const formData = new URLSearchParams({
        ...session.hiddenInputs,
        txt_codigo_autenticidade: session.authCode, // Use auth code from session
        txt_codigo_captcha: captchaCode, // Use captcha code from user input
      });

      // Use the correct form action URL from backup
      const baseUrl = 'https://sistemas.unesp.br';
      const formActionUrl = `${baseUrl}/academico/publico/documento.emitir.action`;
      const documentUrl = 'https://sistemas.unesp.br/academico/publico/documento.action';

      // Ensure required Unesp cookies are set
      try {
        const redimensionarCookie = 'redimensionar=normal; Path=/; Domain=documento.unesp.br';
        await session.cookieJar.setCookie(redimensionarCookie, baseUrl);
        this.logger.debug('Set redimensionar cookie');
      } catch (error) {
        this.logger.warn('Could not set redimensionar cookie:', error);
      }

      // Submit the form using exact backup parameters
      const submitResponse = await session.axiosInstance!.post(
        formActionUrl, // Use the correct form action URL from backup
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: await session.cookieJar.getCookieString(documentUrl),
            Referer: documentUrl, // The form page where we got the captcha
          },
          maxRedirects: 0,
          validateStatus: (status) => status < 400,
        },
      );

      this.logger.debug('Form submission response:', {
        status: submitResponse.status,
        contentType: (submitResponse.headers['content-type'] as string) || 'unknown',
        dataLength: submitResponse.data ? (submitResponse.data as string | Buffer).length : 0,
      });

      // Check if response is a PDF or handle HTML error response
      const contentType = submitResponse.headers['content-type'] as string;

      // Handle HTML responses (error cases or success redirect)
      if (contentType && contentType.includes('text/html')) {
        return await this.htmlResponseService.handleHtmlResponse(
          (submitResponse.data as Buffer | string).toString(),
          sessionId,
          userId,
          session,
        );
      }

      // Check if response is a PDF
      if (!contentType || !contentType.includes('application/pdf')) {
        return {
          success: false,
          error: `Unexpected response type: ${contentType}`,
        };
      }

      const pdfBuffer = Buffer.from(submitResponse.data as ArrayBuffer);

      // Save captcha training data for successful validations (PDF response means success)
      if (session.captchaImageBase64) {
        try {
          const { CaptchaService } = await import('./captcha.service');
          const captchaService = new CaptchaService(this.s3Service);
          await captchaService.saveCaptchaTrainingData(session.captchaImageBase64, captchaCode);
        } catch (error) {
          this.logger.warn('Failed to save captcha training data:', error);
        }
      }

      // Validate PDF document
      return await this.documentValidationService.validatePdfDocument(
        session,
        pdfBuffer,
        enrollmentNumber,
        captchaCode,
        sessionId,
        userId,
      );
    } catch (error: unknown) {
      this.logger.error('Error in document validation:', error);

      // Check if this is a network error that should trigger manual fallback
      const isNetworkError = this.networkErrorService.isNetworkError(error);

      if (isNetworkError) {
        this.logger.warn('Network error during document validation, attempting manual fallback', {
          sessionId,
          userId,
          errorCode: (error as { code?: string })?.code,
          errorMessage: (error as { message?: string })?.message,
        });

        // Try to create manual fallback for network errors during validation
        try {
          // Get session to extract auth code if possible
          let sessionData = this.sessions.get(sessionId);
          if (!sessionData) {
            sessionData = this.sessionManagementService.getSession(sessionId);
          }

          const manualApprovalResult = await this.networkErrorService.createNetworkErrorFallback(
            userId,
            sessionId,
            sessionData?.authCode,
            enrollmentNumber,
            captchaCode,
            error,
            'Network error during document validation',
          );

          return {
            success: false,
            error: 'Erro de conexão durante a validação - documento redirecionado para aprovação manual',
            fallbackToManual: true,
            manualApprovalId: manualApprovalResult.documentId,
          };
        } catch (fallbackError) {
          this.logger.error('Failed to create manual fallback for validation network error:', fallbackError);
        }
      }

      // Clean up session on error
      this.sessionManagementService.deleteSession(sessionId);

      return {
        success: false,
        error: `Erro interno: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Get session with security check
   */
  getSession(sessionId: string, userId: string): CaptchaSession | undefined {
    // Try local sessions first, fallback to sessionManagementService
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.sessionManagementService.getSession(sessionId);
    }

    if (!session) {
      return undefined;
    }

    // Security check: ensure the requesting user owns this session
    if (session.userId !== userId) {
      this.logger.error(
        `Unauthorized access attempt: User ${userId} tried to access session ${sessionId} owned by user ${session.userId}`,
      );
      throw new Error('Unauthorized: Session belongs to different user');
    }

    return session;
  }

  /**
   * Clear session with security check
   */
  clearSession(sessionId: string, userId: string): void {
    // Try local sessions first, fallback to sessionManagementService
    let session = this.sessions.get(sessionId);
    if (!session) {
      session = this.sessionManagementService.getSession(sessionId);
    }

    if (session && session.userId !== userId) {
      this.logger.error(
        `Unauthorized session clear attempt: User ${userId} tried to clear session ${sessionId} owned by user ${session.userId}`,
      );
      throw new Error('Unauthorized: Cannot clear session belonging to different user');
    }

    // Clear from both stores
    this.sessions.delete(sessionId);
    this.sessionManagementService.deleteSession(sessionId);
    this.logger.debug(`Session ${sessionId} cleared for user ${userId}`);
  }
}
