import { Injectable, Logger } from '@nestjs/common';
import { load } from 'cheerio';
import { ValidationResult } from '../university-validation.types';

@Injectable()
export class HtmlResponseService {
  private readonly logger = new Logger(HtmlResponseService.name);

  /**
   * Handle HTML response from Unesp system (error cases or success redirects)
   */
  handleHtmlResponse(responseHtml: string): ValidationResult {
    // HTML is never sufficient proof of identity. A valid response must be the
    // university-issued PDF and pass the same enrollment/name verification.
    const $ = load(responseHtml);
    const providerErrors = $('.errormsg')
      .map((_, element) => $(element).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(Boolean);
    const normalizedErrors = this.normalizeForMatching(providerErrors.join(' '));

    this.logger.debug('Analyzing response HTML for errors:', {
      htmlLength: responseHtml.length,
      providerErrorCount: providerErrors.length,
    });

    // Check for authentication code errors
    if (
      /codigo de autentica(?:cao|cidade).*(?:nao consta|invalid)/.test(normalizedErrors) ||
      /autenticidade.*(?:nao consta|invalid)/.test(normalizedErrors)
    ) {
      return {
        success: false,
        error: 'Código de autenticação inválido',
      };
    }

    // Check for required field errors - expanded checks
    if (/autenticidade.*campo obrigatorio|campo obrigatorio.*autenticidade/.test(normalizedErrors)) {
      this.logger.debug('Auth code field error detected');
      return {
        success: false,
        needsNewCaptcha: true,
        error: 'Código de autenticidade não fornecido',
      };
    }

    // Check for captcha/security code errors - comprehensive checks
    if (/(?:captcha|codigo de seguranca).{0,40}(?:invalid|incorret)/.test(normalizedErrors)) {
      return {
        success: false,
        needsNewCaptcha: true,
        error: 'Captcha incorreto',
      };
    }

    // Check for enrollment not found
    if (/consulte a data de validade no documento|documento.*expirad/.test(normalizedErrors)) {
      return {
        success: false,
        error: 'Documento expirado',
      };
    }

    // Unexpected HTML must fail closed. Never persist scraped HTML or secrets as
    // a substitute for the original student document.
    return this.handleUnexpectedResponse(responseHtml);
  }

  /**
   * Handle unexpected server responses with manual approval fallback
   */
  private handleUnexpectedResponse(responseHtml: string): ValidationResult {
    this.logger.warn('Unexpected HTML received from university verification service', {
      responseLength: responseHtml.length,
    });
    return {
      success: false,
      error: 'Resposta inesperada do servidor da universidade.',
      fallbackToManual: false,
    };
  }

  private normalizeForMatching(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase();
  }
}
