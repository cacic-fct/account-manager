import { Injectable, Logger } from '@nestjs/common';
import { CaptchaSession, ValidationResult } from '../university-validation.types';
import { StudentVerificationService } from '../../student-verification/student-verification.service';
import { PdfProcessingService } from './pdf-processing.service';
import { UserVerificationService } from './user-verification.service';
import { S3Service } from '../../common/services/s3.service';

interface VerificationDetails {
  verificationType: 'unesp_student' | 'external_user';
  nameMatches?: boolean;
  extractedEnrollment?: string;
  expectedFullname?: string;
  enrollmentMatches?: boolean;
  fullnameMatches?: boolean;
  combinedResult?: boolean;
  expectedEnrollment?: string;
}

@Injectable()
export class DocumentValidationService {
  private readonly logger = new Logger(DocumentValidationService.name);

  constructor(
    private readonly studentVerificationService: StudentVerificationService,
    private readonly pdfProcessingService: PdfProcessingService,
    private readonly userVerificationService: UserVerificationService,
    private readonly s3Service: S3Service,
  ) {}

  /**
   * Extract authentication code from PDF buffer
   */
  async extractAuthCodeFromPdf(pdfBuffer: Buffer): Promise<string> {
    try {
      return await this.pdfProcessingService.extractAuthCodeFromPdf(pdfBuffer);
    } catch (error) {
      this.logger.error('Failed to extract auth code from PDF:', error);
      throw new Error('Código de autenticidade não encontrado no PDF');
    }
  }

  /**
   * Extract enrollment number from PDF buffer
   */
  async extractEnrollmentFromPdf(pdfBuffer: Buffer): Promise<string | null> {
    try {
      return await this.pdfProcessingService.extractEnrollmentFromPdf(pdfBuffer);
    } catch (error) {
      this.logger.warn('Failed to extract enrollment from PDF:', error);
      return null; // This is optional, so don't throw
    }
  }

  /**
   * Validate PDF document once it's downloaded
   */
  async validatePdfDocument(
    session: CaptchaSession,
    pdfBuffer: Buffer,
    enrollmentNumber: string,
    captchaCode: string,
    sessionId: string,
    userId: string,
  ): Promise<ValidationResult> {
    try {
      if (!session.authCode) {
        return { success: false, error: 'Código de autenticidade ausente na sessão' };
      }

      const returnedAuthCode = await this.pdfProcessingService.extractAuthCodeFromPdf(pdfBuffer);
      const normalizeAuthCode = (value: string) => value.replace(/[^a-f0-9]/gi, '').toUpperCase();
      if (normalizeAuthCode(returnedAuthCode) !== normalizeAuthCode(session.authCode)) {
        this.logger.warn('University response authentication code did not match the requested document');
        return { success: false, error: 'A resposta da universidade não corresponde ao documento enviado' };
      }

      const pdfVerification = await this.studentVerificationService.verifyPdfDocument(pdfBuffer);
      if (!pdfVerification.success || !pdfVerification.data) {
        const manual = await this.studentVerificationService.storeManualReviewDocument(pdfBuffer, userId);
        return {
          success: false,
          error: 'Não foi possível confirmar a validade do documento automaticamente.',
          fallbackToManual: true,
          manualApprovalId: manual.documentId,
        };
      }
      if (!pdfVerification.data.isValid) {
        return {
          success: false,
          error: pdfVerification.data.expirationDate
            ? 'O documento retornado pela universidade está expirado.'
            : 'Não foi possível confirmar a validade do documento.',
        };
      }

      this.logger.debug('Validating PDF document:', {
        pdfSize: pdfBuffer.length,
      });

      let isExternal: boolean;
      let userFullname: string;
      try {
        isExternal = await this.userVerificationService.isExternalUser(userId);
        userFullname = await this.userVerificationService.getUserFullname(userId);
      } catch {
        this.logger.warn('Identity data unavailable; routing verified provider PDF to manual review');
        const manual = await this.studentVerificationService.storeManualReviewDocument(pdfBuffer, userId);
        return {
          success: false,
          error: 'Não foi possível confirmar os dados do perfil automaticamente.',
          fallbackToManual: true,
          manualApprovalId: manual.documentId,
        };
      }

      this.logger.debug('User verification type determined:', {
        isExternal,
      });

      let verificationResult: boolean;
      let verificationDetails: VerificationDetails;

      if (isExternal) {
        // External user verification by fullname
        const externalVerification = await this.userVerificationService.verifyExternalUser(pdfBuffer, userFullname);

        verificationResult = externalVerification.nameMatches && externalVerification.extractedEnrollment !== null;
        verificationDetails = {
          verificationType: 'external_user',
          nameMatches: externalVerification.nameMatches,
          extractedEnrollment: externalVerification.extractedEnrollment || undefined,
          expectedFullname: userFullname || undefined,
        };
      } else {
        // Unesp student verification by enrollment + fullname
        const unespVerification = await this.userVerificationService.verifyUnespStudent(
          userId,
          pdfBuffer,
          enrollmentNumber,
          userFullname,
        );

        verificationResult = unespVerification.combinedResult;
        verificationDetails = {
          verificationType: 'unesp_student',
          enrollmentMatches: unespVerification.enrollmentMatches,
          fullnameMatches: unespVerification.fullnameMatches,
          combinedResult: unespVerification.combinedResult,
          expectedEnrollment: enrollmentNumber,
          expectedFullname: userFullname || undefined,
        };
      }

      // Set verification status in Keycloak if successful
      if (verificationResult) {
        const approval = await this.studentVerificationService.storeAutomatedApproval(
          pdfBuffer,
          userId,
          session.authCode,
          pdfVerification.data.emissionDate,
          pdfVerification.data.expirationDate,
        );

        try {
          await this.userVerificationService.setVerificationStatus(
            userId,
            true,
            isExternal ? 'external_user' : 'unesp_student',
            verificationDetails,
          );

          if (isExternal && verificationDetails.extractedEnrollment) {
            await this.userVerificationService.applyExternalUserVerification(
              userId,
              verificationDetails.extractedEnrollment,
            );
          }
        } catch (error) {
          await this.userVerificationService
            .setVerificationStatus(userId, false, isExternal ? 'external_user' : 'unesp_student')
            .catch(() => undefined);
          await this.studentVerificationService.deferAutomatedApproval(approval.id, userId);
          this.logger.error('Identity synchronization failed after provider verification', error);
          return {
            success: false,
            error: 'Documento confirmado, mas encaminhado para análise manual por falha de sincronização.',
            fallbackToManual: true,
            manualApprovalId: approval.id,
          };
        }
      }

      // Save captcha training data for successful validations
      if (session.captchaImageBase64 && verificationResult) {
        try {
          const { CaptchaService } = await import('./captcha.service');
          const captchaService = new CaptchaService(this.s3Service);
          await captchaService.saveCaptchaTrainingData(session.captchaImageBase64, captchaCode);
        } catch (error) {
          this.logger.warn('Failed to save captcha training data:', error);
        }
      }

      const errorMessage = isExternal
        ? 'Nome no documento não confere com o nome cadastrado'
        : 'Documento não confere com os dados cadastrados (matrícula e/ou nome)';

      return {
        success: verificationResult,
        isValid: verificationResult,
        error: verificationResult ? undefined : errorMessage,
        data: {
          validationTimestamp: new Date().toISOString(),
          responseType: 'pdf',
          pdfSize: pdfBuffer.length,
          verificationType: verificationDetails.verificationType,
        },
      };
    } catch (error) {
      this.logger.error('Error validating PDF document:', error);
      try {
        const manual = await this.studentVerificationService.storeManualReviewDocument(pdfBuffer, userId);
        return {
          success: false,
          error: 'Documento encaminhado para análise manual após falha na validação automática.',
          fallbackToManual: true,
          manualApprovalId: manual.documentId,
        };
      } catch {
        // The original error remains the most useful safe outcome when the
        // durable manual queue is also unavailable.
      }
      return {
        success: false,
        error: 'Erro ao processar documento PDF',
      };
    }
  }
}
