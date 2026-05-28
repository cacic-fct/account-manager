import { Injectable, Logger } from '@nestjs/common';
import * as cheerio from 'cheerio';
import { CookieJar } from 'tough-cookie';
import { CaptchaSession } from '../university-validation.types';

@Injectable()
export class SessionManagementService {
  private readonly logger = new Logger(SessionManagementService.name);
  public readonly sessions = new Map<string, CaptchaSession>();
  private readonly documentUrl =
    'https://sistemas.unesp.br/academico/publico/documento.action';

  /**
   * Create a new session with cookie jar
   */
  createSession(sessionId: string): CaptchaSession {
    const session: CaptchaSession = {
      sessionId,
      cookieJar: new CookieJar(),
      createdAt: new Date(),
    };

    this.sessions.set(sessionId, session);
    this.logger.debug('Created new session:', sessionId);

    return session;
  }

  /**
   * Get existing session
   */
  getSession(sessionId: string): CaptchaSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Delete session
   */
  deleteSession(sessionId: string): void {
    this.sessions.delete(sessionId);
    this.logger.debug('Deleted session:', sessionId);
  }

  /**
   * Clean up old sessions (older than 1 hour)
   */
  cleanupOldSessions(): void {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.createdAt < oneHourAgo) {
        this.sessions.delete(sessionId);
        this.logger.debug('Cleaned up old session:', sessionId);
      }
    }
  }

  /**
   * Submit document validation form
   */
  async submitDocumentForm(
    session: CaptchaSession,
    enrollmentNumber: string,
    captchaCode: string,
  ): Promise<{
    success: boolean;
    data?: Buffer;
    error?: string;
    redirectUrl?: string;
  }> {
    try {
      this.logger.debug('Submitting document validation form', {
        enrollmentNumber,
        sessionId: session.sessionId,
        pageUrl: session.pageUrl,
        captchaCode: captchaCode.substring(0, 2) + '***', // Security: partial captcha
        hasHiddenInputs:
          !!session.hiddenInputs &&
          Object.keys(session.hiddenInputs).length > 0,
        hiddenInputsCount: session.hiddenInputs
          ? Object.keys(session.hiddenInputs).length
          : 0,
      });

      // Submit the form
      const formData = new URLSearchParams({
        numeroMatricula: enrollmentNumber,
        codigoCaptcha: captchaCode,
        submit: 'Validar',
      });

      // Add hidden inputs if available
      if (session.hiddenInputs) {
        Object.entries(session.hiddenInputs).forEach(([key, value]) => {
          formData.append(key, value);
        });
        this.logger.debug('Added hidden inputs to form:', {
          hiddenInputKeys: Object.keys(session.hiddenInputs),
          hiddenInputValues: Object.fromEntries(
            Object.entries(session.hiddenInputs).map(([k, v]) => [
              k,
              v.length > 50 ? `${v.substring(0, 50)}...` : v,
            ]),
          ),
        });
      } else {
        this.logger.warn(
          'No hidden inputs found in session - this may cause validation failure',
        );
      }

      // Enhanced debugging of the complete form submission
      this.logger.debug('Complete form submission details:', {
        url: this.documentUrl,
        method: 'POST',
        enrollmentNumber,
        captchaCodeLength: captchaCode.length,
        formDataEntries: Array.from(formData.entries()).map(([key, value]) => [
          key,
          key.includes('codigo') ||
          key.includes('captcha') ||
          key.includes('Captcha')
            ? value.substring(0, 2) + '***'
            : value.length > 100
              ? value.substring(0, 100) + '...'
              : value,
        ]),
        totalFormFields: Array.from(formData.entries()).length,
        sessionHasCookies: !!session.cookieJar,
      });

      const submitResponse = await session.axiosInstance!.post(
        this.documentUrl,
        formData.toString(),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Referer: this.documentUrl,
            Cookie: await session.cookieJar.getCookieString(this.documentUrl),
          },
          responseType: 'arraybuffer',
          validateStatus: () => true, // Accept all status codes
        },
      );

      this.logger.debug('Form submission response:', {
        status: submitResponse.status,
        headers: Object.keys(submitResponse.headers),
        dataLength: submitResponse.data?.length,
        contentType: submitResponse.headers['content-type'],
      });

      // Check if response is a PDF (successful validation)
      const contentType = submitResponse.headers['content-type'] as string;
      if (contentType && contentType.includes('application/pdf')) {
        this.logger.debug('Received PDF response - validation successful');
        return {
          success: true,
          data: Buffer.from(submitResponse.data),
        };
      }

      // Check if response is HTML (error page) instead of PDF
      if (contentType && contentType.includes('text/html')) {
        this.logger.debug('Received HTML response, checking for errors');

        const htmlContent = submitResponse.data as string;
        const $ = cheerio.load(htmlContent);

        // Enhanced debugging - log more details about the HTML response
        this.logger.debug('HTML Response Details:', {
          contentLength: htmlContent.length,
          contentType,
          url: submitResponse.config?.url,
          status: submitResponse.status,
          statusText: submitResponse.statusText,
        });

        // Log the page title and any error messages
        const pageTitle = $('title').text().trim();
        const bodyText = $('body').text().trim();
        const errorDivs = $('.error, .alert, .message, [class*="erro"]')
          .map((_, el) => $(el).text().trim())
          .get();
        const formErrors = $('input + .error, .field-error, .validation-error')
          .map((_, el) => $(el).text().trim())
          .get();

        this.logger.debug('HTML Content Analysis:', {
          pageTitle,
          bodyTextLength: bodyText.length,
          bodyPreview: bodyText,
          errorDivs,
          formErrors,
          hasErrorKeyword:
            bodyText.includes('erro') || bodyText.includes('Erro'),
          hasValidationKeyword:
            bodyText.includes('validação') || bodyText.includes('Validação'),
        });

        // Log the form structure if present
        const forms = $('form');
        if (forms.length > 0) {
          this.logger.debug('Form Analysis:', {
            formCount: forms.length,
            formActions: forms.map((_, form) => $(form).attr('action')).get(),
            formMethods: forms.map((_, form) => $(form).attr('method')).get(),
            inputTypes: $('input')
              .map((_, input) => $(input).attr('type'))
              .get(),
            inputNames: $('input')
              .map((_, input) => $(input).attr('name'))
              .get(),
          });
        }

        // Check for specific validation errors
        if (
          htmlContent.includes('Matrícula não encontrada') ||
          htmlContent.includes('Número de matrícula inválido')
        ) {
          return {
            success: false,
            error: 'Número de matrícula não encontrado',
          };
        }

        if (
          htmlContent.includes('Código de verificação incorreto') ||
          htmlContent.includes('Captcha inválido') ||
          htmlContent.includes('código da imagem incorreto')
        ) {
          return {
            success: false,
            error: 'Código de verificação incorreto',
          };
        }

        // Check for generic validation errors
        if (
          htmlContent.includes('Erro na validação') ||
          htmlContent.includes('Tente novamente')
        ) {
          this.logger.debug('Generic validation error detected in HTML');

          // Log part of the HTML content for debugging
          const bodyText = $('body').text().trim().substring(0, 500);
          this.logger.debug('HTML body excerpt:', bodyText);

          return {
            success: false,
            error:
              'Erro na validação. Verifique os dados informados e tente novamente.',
          };
        }

        // Check for redirects
        const metaRefresh = $('meta[http-equiv="refresh"]').attr('content');
        if (metaRefresh) {
          const urlMatch = metaRefresh.match(/url=(.+)/i);
          if (urlMatch) {
            return {
              success: false,
              error: 'Redirecionamento detectado',
              redirectUrl: urlMatch[1],
            };
          }
        }

        return {
          success: false,
          error: 'Resposta HTML inesperada do servidor',
        };
      }

      return {
        success: false,
        error: `Tipo de resposta inesperado: ${contentType}`,
      };
    } catch (error) {
      this.logger.error('Error submitting document form:', error);
      return {
        success: false,
        error: `Erro na submissão: ${error instanceof Error ? error.message : 'Erro desconhecido'}`,
      };
    }
  }

  /**
   * Extract JSESSIONID from cookie string
   */
  extractJSESSIONID(cookieString: string): string | null {
    if (!cookieString) {
      return null;
    }
    const match = cookieString.match(/JSESSIONID=([^;]+)/);
    return match ? match[1] : null;
  }
}
