import { Injectable, Logger } from '@nestjs/common';
import {
  CaptchaSession,
  ValidationResult,
} from '../university-validation.types';
import { StudentVerificationService } from '../../student-verification/student-verification.service';

@Injectable()
export class HtmlResponseService {
  private readonly logger = new Logger(HtmlResponseService.name);

  constructor(
    private readonly studentVerificationService: StudentVerificationService,
  ) {}

  /**
   * Handle HTML response from Unesp system (error cases or success redirects)
   */
  async handleHtmlResponse(
    responseHtml: string,
    sessionId: string,
    userId: string,
    session: CaptchaSession,
  ): Promise<ValidationResult> {
    // Check for successful validation (HTML success page) first
    const isSuccess =
      responseHtml.includes('validado com sucesso') ||
      responseHtml.includes('documento válido') ||
      responseHtml.includes('autenticação confirmada');

    if (isSuccess) {
      return {
        success: true,
        isValid: true,
        data: {
          authCode: session.authCode,
          validationTimestamp: new Date().toISOString(),
          responseType: 'html',
        },
      };
    }

    // If not successful, proceed with detailed error analysis
    this.logger.debug('Analyzing response HTML for errors:', {
      htmlLength: responseHtml.length,
      htmlSnippet: responseHtml.substring(0, 1000),
      fullResponse: responseHtml, // Log the full response to see exact error messages
      containsAuthError: responseHtml.includes('autenticação'),
      containsCaptchaError:
        responseHtml.includes('segurança') || responseHtml.includes('captcha'),
      containsObrigatorio: responseHtml.includes('obrigatório'),
      containsInvalido: responseHtml.includes('inválido'),
      // Check for specific error patterns
      specificErrors: {
        'segurança está inválido': responseHtml.includes(
          'segurança está inválido',
        ),
        'segurança inválido': responseHtml.includes('segurança inválido'),
        'captcha inválido': responseHtml.includes('captcha inválido'),
        'Digite o código': responseHtml.includes('Digite o código'),
        'Código de Segurança': responseHtml.includes('Código de Segurança'),
        'Validade do documento': responseHtml.includes(
          'Consulte a data de validade no documento.',
        ),
      },
    });

    // Check for authentication code errors
    if (
      responseHtml.includes(
        'O cÃ³digo de autenticação informado não consta em nossos registros',
      ) ||
      responseHtml.includes(
        'O código de autenticação informado não consta em nossos registros',
      )
    ) {
      return {
        success: false,
        error: 'Código de autenticação inválido',
      };
    }

    // Check for required field errors - expanded checks
    if (
      responseHtml.includes('Código de autenticidade é um campo obrigatório') ||
      responseHtml.includes('Campo obrigatório')
    ) {
      this.logger.debug('Auth code field error detected');
      return {
        success: false,
        needsNewCaptcha: true,
        error: 'Código de autenticidade não fornecido',
      };
    }

    // Check for captcha/security code errors - comprehensive checks
    if (responseHtml.includes('Código de segurança está inválido')) {
      return {
        success: false,
        needsNewCaptcha: true,
        error: 'Captcha incorreto',
      };
    }

    // Check for enrollment not found
    if (responseHtml.includes('Consulte a data de validade no documento')) {
      return {
        success: false,
        error: 'Documento expirado',
      };
    }

    // For unexpected responses, try manual approval fallback
    return await this.handleUnexpectedResponse(
      responseHtml,
      sessionId,
      userId,
      session,
    );
  }

  /**
   * Handle unexpected server responses with manual approval fallback
   */
  async handleUnexpectedResponse(
    responseHtml: string,
    sessionId: string,
    userId: string,
    session: CaptchaSession,
  ): Promise<ValidationResult> {
    try {
      this.logger.debug(
        'Creating manual approval fallback due to unexpected server response',
        { sessionId, userId },
      );

      // Create a temporary document for manual verification
      const fallbackDocument = {
        buffer: Buffer.from(
          `Auth Code: ${session?.authCode || 'N/A'}\nReason: Unexpected server response\nResponse: ${responseHtml.substring(0, 1000)}\nTimestamp: ${new Date().toISOString()}`,
        ),
        originalname: `unexpected-response-${sessionId}.txt`,
        mimetype: 'text/plain',
      } as Express.Multer.File;

      const manualApprovalResult =
        await this.studentVerificationService.uploadDocument(
          fallbackDocument,
          userId,
          true,
        );

      return {
        success: false,
        error:
          'Resposta inesperada do servidor - redirecionado para aprovação manual',
        fallbackToManual: true,
        manualApprovalId: manualApprovalResult.documentId,
      };
    } catch (fallbackError) {
      this.logger.error(
        'Failed to create manual approval fallback:',
        fallbackError,
      );
      return {
        success: false,
        error: 'Resposta inesperada do servidor',
        fallbackToManual: true,
      };
    }
  }
}
