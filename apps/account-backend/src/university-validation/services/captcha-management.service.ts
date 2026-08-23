import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { CaptchaSession, ValidationResult } from '../university-validation.types';
import { RedisService } from '../../redis/redis.service';
import { SessionManagementService } from './session-management.service';
import { HtmlResponseService } from './html-response.service';
import { DocumentValidationService } from './document-validation.service';
import {
  ExternalVerificationResilienceService,
  ExternalVerificationUnavailableError,
} from './external-verification-resilience.service';

@Injectable()
export class CaptchaManagementService {
  private readonly logger = new Logger(CaptchaManagementService.name);
  private readonly activeSessionOperations = new Map<string, string>();
  private readonly operationLockTtlSeconds: number;

  constructor(
    private readonly sessionManagementService: SessionManagementService,
    private readonly htmlResponseService: HtmlResponseService,
    private readonly documentValidationService: DocumentValidationService,
    private readonly externalVerificationResilience: ExternalVerificationResilienceService,
    private readonly redis: RedisService,
    configService: ConfigService,
  ) {
    const configuredTtlMs = Number.parseInt(
      configService.get<string>('UNIVERSITY_EXTERNAL_OPERATION_LOCK_TTL_MS') ?? '',
      10,
    );
    this.operationLockTtlSeconds = Math.max(
      1,
      Math.ceil((Number.isFinite(configuredTtlMs) && configuredTtlMs > 0 ? configuredTtlMs : 10 * 60 * 1000) / 1000),
    );
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
    this.logger.debug('Getting university captcha', {
      hasAuthCode: !!authCode,
      hasEnrollmentNumber: !!enrollmentNumber,
    });

    return this.externalVerificationResilience.execute('get-captcha', async () => {
      // Import required modules
      const axios = await import('axios');
      const cheerio = await import('cheerio');
      const { CookieJar } = await import('tough-cookie');

      const cookieJar = new CookieJar();
      const documentUrl = 'https://sistemas.unesp.br/academico/publico/documento.action';
      const captchaUrl = 'https://sistemas.unesp.br/academico/captcha.jpg';

      const axiosInstance = axios.default.create({
        timeout: this.externalVerificationResilience.timeoutMs,
        maxRedirects: 0,
        maxContentLength: this.externalVerificationResilience.maxResponseBytes,
        maxBodyLength: this.externalVerificationResilience.maxResponseBytes,
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
      const pageResponse = await axiosInstance.get<string>(documentUrl, {
        responseType: 'text',
        maxContentLength: 1024 * 1024,
        validateStatus: (status) => status === 200,
      });

      if (pageResponse.status !== 200) {
        throw new Error(`Failed to access document page: ${pageResponse.status}`);
      }

      // Extract cookies from response
      const setCookieHeaders = pageResponse.headers['set-cookie'];
      if (setCookieHeaders) {
        for (const cookie of setCookieHeaders) {
          try {
            await cookieJar.setCookie(cookie, documentUrl);
          } catch {
            this.logger.debug('Rejected malformed university provider cookie');
          }
        }
      }

      // Parse the HTML to extract hidden form inputs
      const $ = cheerio.load(pageResponse.data);
      const hiddenInputs: Record<string, string> = {};
      $('input[type="hidden"]').each((_, element) => {
        const name = $(element).attr('name');
        const value = $(element).attr('value');
        if (name && value && name.length <= 100 && value.length <= 4096 && Object.keys(hiddenInputs).length < 50) {
          hiddenInputs[name] = value;
        }
      });

      // Check for critical form inputs that are necessary for submission
      const pageHtml = pageResponse.data;

      // Look for specific authentication code input field
      const hasAuthCodeInput = $('input[name="txt_codigo_autenticidade"]').length > 0;

      // Look for specific captcha input field
      const hasCaptchaInput = $('input[name="txt_codigo_captcha"]').length > 0;
      const form = $('form')
        .filter(
          (_, element) =>
            $(element).find('input[name="txt_codigo_autenticidade"]').length > 0 &&
            $(element).find('input[name="txt_codigo_captcha"]').length > 0,
        )
        .first();
      const formActionUrl = this.resolveTrustedFormAction(form.attr('action'), documentUrl);

      if (!hasAuthCodeInput || !hasCaptchaInput || !formActionUrl) {
        this.logger.error('Essential form input fields missing from Unesp page', {
          pageUrl: documentUrl,
          hasAuthCodeInput,
          hasCaptchaInput,
          hasTrustedFormAction: !!formActionUrl,
          pageSize: pageHtml.length,
        });
        throw new Error('UNESP_NETWORK_ERROR: Server appears to be malfunctioning - required form fields missing');
      }

      session.hiddenInputs = hiddenInputs;
      session.pageUrl = documentUrl;
      session.formActionUrl = formActionUrl;

      // Fetch the captcha image
      this.logger.debug(`Fetching captcha from: ${captchaUrl}`);
      const captchaResponse = await axiosInstance.get(captchaUrl, {
        responseType: 'arraybuffer',
        headers: {
          Cookie: await cookieJar.getCookieString(documentUrl),
          Referer: documentUrl,
        },
        validateStatus: (status) => status === 200,
        maxContentLength: 1024 * 1024,
      });

      if (captchaResponse.status !== 200) {
        throw new Error(`Failed to fetch captcha: ${captchaResponse.status}`);
      }

      // Convert captcha to base64
      const captchaBuffer = Buffer.from(captchaResponse.data);
      const captchaContentType = String(captchaResponse.headers['content-type'] ?? '').toLowerCase();
      if (
        !captchaContentType.startsWith('image/') ||
        captchaBuffer.length === 0 ||
        captchaBuffer.length > 1024 * 1024
      ) {
        throw new Error('Unexpected captcha response');
      }
      const captchaSetCookieHeaders = captchaResponse.headers['set-cookie'];
      if (captchaSetCookieHeaders) {
        for (const cookie of captchaSetCookieHeaders) {
          await cookieJar.setCookie(cookie, captchaUrl);
        }
      }
      session.captchaImageBase64 = captchaBuffer.toString('base64');

      await this.sessionManagementService.storeSession(session);

      this.logger.debug('Captcha fetched successfully', {
        captchaSize: captchaBuffer.length,
        hiddenInputsCount: Object.keys(hiddenInputs).length,
      });

      return session;
    });
  }

  /**
   * Refresh captcha for existing session
   */
  async refreshCaptcha(sessionId: string, userId: string): Promise<CaptchaSession> {
    this.logger.debug('Refreshing university captcha');

    const session = await this.sessionManagementService.getOwnedSession(sessionId, userId);
    if (!session) {
      throw new BadRequestException('Sessão de validação não encontrada ou expirada.');
    }
    if (!(await this.tryStartSessionOperation(sessionId))) {
      throw new ConflictException('Já existe uma operação em andamento para esta sessão.');
    }

    try {
      const axiosInstance = await this.ensureAxiosInstance(session);
      return await this.externalVerificationResilience.execute('refresh-captcha', async () => {
        const captchaUrl = 'https://sistemas.unesp.br/academico/captcha.jpg';

        // Use existing axios instance and cookies from the session
        const captchaResponse = await axiosInstance.get(captchaUrl, {
          responseType: 'arraybuffer',
          headers: {
            Referer: 'https://sistemas.unesp.br/academico/publico/documento.action',
            Cookie: await session.cookieJar.getCookieString(
              'https://sistemas.unesp.br/academico/publico/documento.action',
            ),
          },
          maxRedirects: 0,
          maxContentLength: this.externalVerificationResilience.maxResponseBytes,
          validateStatus: (status) => status === 200,
        });

        if (captchaResponse.status !== 200) {
          throw new Error(`Failed to fetch new captcha: ${captchaResponse.status}`);
        }

        // Convert new captcha to base64
        const captchaBuffer = Buffer.from(captchaResponse.data);
        const captchaContentType = String(captchaResponse.headers['content-type'] ?? '').toLowerCase();
        if (
          !captchaContentType.startsWith('image/') ||
          captchaBuffer.length === 0 ||
          captchaBuffer.length > 1024 * 1024
        ) {
          throw new Error('Unexpected captcha response');
        }
        const refreshedCookies = captchaResponse.headers['set-cookie'];
        if (refreshedCookies) {
          for (const cookie of refreshedCookies) {
            await session.cookieJar.setCookie(cookie, captchaUrl);
          }
        }
        session.captchaImageBase64 = captchaBuffer.toString('base64');

        await this.sessionManagementService.storeSession(session);

        this.logger.debug('Captcha refreshed successfully', {
          captchaSize: captchaBuffer.length,
        });

        return session;
      });
    } finally {
      await this.finishSessionOperation(sessionId);
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
    this.logger.debug('Starting university document validation');
    let operationStarted = false;

    try {
      // Get session from local storage first, fallback to sessionManagementService
      const session = await this.sessionManagementService.getOwnedSession(sessionId, userId);

      if (!session) {
        return {
          success: false,
          error: 'Sessão de validação não encontrada ou expirada.',
        };
      }

      if (!(await this.tryStartSessionOperation(sessionId))) {
        return {
          success: false,
          error: 'Já existe uma operação em andamento para esta sessão.',
        };
      }
      operationStarted = true;

      // Check that we have the required session data
      const formActionUrl = session.formActionUrl;
      if (!session.hiddenInputs || !session.pageUrl || !formActionUrl) {
        this.logger.error('Form data missing from session', {
          hasHiddenInputs: !!session.hiddenInputs,
          hasPageUrl: !!session.pageUrl,
          hasFormActionUrl: !!session.formActionUrl,
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

      const axiosInstance = await this.ensureAxiosInstance(session);
      if (!axiosInstance) {
        return { success: false, error: 'Sessão externa inválida ou expirada' };
      }

      this.logger.debug('Submitting form with data:', {
        captchaCodeLength: captchaCode.length,
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

      const documentUrl = 'https://sistemas.unesp.br/academico/publico/documento.action';

      // Submit the form using exact backup parameters
      const submitResponse = await this.externalVerificationResilience.execute('validate-document', async () =>
        axiosInstance.post(formActionUrl, formData.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Cookie: await session.cookieJar.getCookieString(documentUrl),
            Referer: documentUrl,
          },
          maxRedirects: 0,
          maxContentLength: this.externalVerificationResilience.maxResponseBytes,
          maxBodyLength: this.externalVerificationResilience.maxResponseBytes,
          responseType: 'arraybuffer',
          validateStatus: (status) => status < 400,
        }),
      );

      const submitSetCookieHeaders = submitResponse.headers['set-cookie'];
      if (submitSetCookieHeaders) {
        for (const cookie of submitSetCookieHeaders) {
          await session.cookieJar.setCookie(cookie, formActionUrl);
        }
      }

      this.logger.debug('Form submission response:', {
        status: submitResponse.status,
        contentType: (submitResponse.headers['content-type'] as string) || 'unknown',
        dataLength: submitResponse.data ? (submitResponse.data as string | Buffer).length : 0,
      });

      // Check if response is a PDF or handle HTML error response
      const contentType = submitResponse.headers['content-type'] as string;

      // Handle HTML responses (error cases or success redirect)
      if (contentType && contentType.includes('text/html')) {
        return this.htmlResponseService.handleHtmlResponse((submitResponse.data as Buffer | string).toString());
      }

      // Check if response is a PDF
      if (!contentType || !contentType.includes('application/pdf')) {
        return {
          success: false,
          error: `Unexpected response type: ${contentType}`,
        };
      }

      const pdfBuffer = Buffer.from(submitResponse.data as ArrayBuffer);
      if (
        pdfBuffer.length === 0 ||
        pdfBuffer.length > 10 * 1024 * 1024 ||
        !pdfBuffer.subarray(0, 5).equals(Buffer.from('%PDF-'))
      ) {
        return {
          success: false,
          error: 'A universidade retornou um documento inválido.',
        };
      }

      // Validate PDF document
      const validationResult = await this.documentValidationService.validatePdfDocument(
        session,
        pdfBuffer,
        enrollmentNumber,
        captchaCode,
        sessionId,
        userId,
      );
      if (validationResult.success || validationResult.fallbackToManual) {
        await this.sessionManagementService.deleteSession(sessionId);
      }
      return validationResult;
    } catch (error: unknown) {
      this.logger.error('Error in document validation', error instanceof Error ? error.message : String(error));

      // Clean up session on error
      await this.sessionManagementService.deleteSession(sessionId);

      return {
        success: false,
        error:
          error instanceof ExternalVerificationUnavailableError
            ? 'O serviço de validação da universidade está temporariamente indisponível.'
            : 'Erro interno durante a validação do documento.',
        fallbackToManual: false,
      };
    } finally {
      if (operationStarted) {
        await this.finishSessionOperation(sessionId);
      }
    }
  }

  /**
   * Get session with security check
   */
  async getSession(sessionId: string, userId: string): Promise<CaptchaSession | undefined> {
    // Try local sessions first, fallback to sessionManagementService
    const session = await this.sessionManagementService.getOwnedSession(sessionId, userId);

    if (!session) {
      return undefined;
    }

    return session;
  }

  /**
   * Clear session with security check
   */
  async clearSession(sessionId: string, userId: string): Promise<void> {
    // Try local sessions first, fallback to sessionManagementService
    const session = await this.sessionManagementService.getSession(sessionId);

    if (session && session.userId !== userId) {
      this.logger.error('Unauthorized university validation session clear attempt');
      throw new Error('Unauthorized: Cannot clear session belonging to different user');
    }

    await this.sessionManagementService.deleteSession(sessionId);
    this.logger.debug('University validation session cleared');
  }

  private resolveTrustedFormAction(action: string | undefined, pageUrl: string): string | undefined {
    if (!action) return undefined;

    try {
      const resolved = new URL(action, pageUrl);
      if (
        resolved.origin !== 'https://sistemas.unesp.br' ||
        resolved.pathname !== '/academico/publico/documento.emitir.action'
      ) {
        return undefined;
      }
      return resolved.href;
    } catch {
      return undefined;
    }
  }

  private async tryStartSessionOperation(sessionId: string): Promise<boolean> {
    if (this.activeSessionOperations.has(sessionId)) return false;

    const lockToken = randomUUID();
    try {
      const acquired = await this.redis.setIfAbsent(
        this.operationLockKey(sessionId),
        lockToken,
        this.operationLockTtlSeconds,
      );
      if (!acquired) return false;

      this.activeSessionOperations.set(sessionId, lockToken);
      return true;
    } catch (error) {
      this.logger.error(
        'Unable to acquire university validation operation lock',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private async finishSessionOperation(sessionId: string): Promise<void> {
    const lockToken = this.activeSessionOperations.get(sessionId);
    this.activeSessionOperations.delete(sessionId);
    if (!lockToken) return;

    try {
      await this.redis.releaseIfOwned(this.operationLockKey(sessionId), lockToken);
    } catch (error) {
      this.logger.warn(
        'Unable to release university validation operation lock',
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  private async ensureAxiosInstance(session: CaptchaSession): Promise<NonNullable<CaptchaSession['axiosInstance']>> {
    if (session.axiosInstance) {
      return session.axiosInstance;
    }

    const axios = await import('axios');
    session.axiosInstance = axios.default.create({
      timeout: this.externalVerificationResilience.timeoutMs,
      maxRedirects: 0,
      maxContentLength: this.externalVerificationResilience.maxResponseBytes,
      maxBodyLength: this.externalVerificationResilience.maxResponseBytes,
      withCredentials: true,
    });
    return session.axiosInstance;
  }

  private operationLockKey(sessionId: string): string {
    return `university-validation:operation:${sessionId}`;
  }
}
