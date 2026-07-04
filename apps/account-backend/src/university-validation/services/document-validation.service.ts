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
      this.logger.debug('Validating PDF document:', {
        pdfSize: pdfBuffer.length,
        enrollmentNumber,
        sessionId,
      });

      // Determine verification type
      const isExternal = await this.userVerificationService.isExternalUser(userId);

      this.logger.debug('User verification type determined:', {
        userId,
        isExternal,
      });

      let verificationResult: boolean;
      let verificationDetails: VerificationDetails;

      if (isExternal) {
        // External user verification by fullname
        const userFullname = await this.userVerificationService.getUserFullname(userId);
        if (!userFullname) {
          return {
            success: false,
            error: 'Nome completo não encontrado no perfil do usuário',
          };
        }

        const externalVerification = await this.userVerificationService.verifyExternalUser(
          userId,
          pdfBuffer,
          userFullname,
        );

        verificationResult = externalVerification.nameMatches;
        verificationDetails = {
          verificationType: 'external_user',
          nameMatches: externalVerification.nameMatches,
          extractedEnrollment: externalVerification.extractedEnrollment || undefined,
          expectedFullname: userFullname || undefined,
        };
      } else {
        // Unesp student verification by enrollment + fullname
        const userFullname = await this.userVerificationService.getUserFullname(userId);

        const unespVerification = await this.userVerificationService.verifyUnespStudent(
          userId,
          pdfBuffer,
          enrollmentNumber,
          userFullname || undefined,
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
        await this.userVerificationService.setVerificationStatus(
          userId,
          true,
          isExternal ? 'external_user' : 'unesp_student',
          verificationDetails,
        );
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
          authCode: session.authCode,
          validationTimestamp: new Date().toISOString(),
          responseType: 'pdf',
          pdfSize: pdfBuffer.length,
          verificationType: verificationDetails.verificationType,
        },
      };
    } catch (error) {
      this.logger.error('Error validating PDF document:', error);
      return {
        success: false,
        error: 'Erro ao processar documento PDF',
      };
    }
  }
}
