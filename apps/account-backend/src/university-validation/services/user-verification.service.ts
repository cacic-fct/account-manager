import { Injectable, Logger } from '@nestjs/common';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PdfProcessingService } from './pdf-processing.service';
import { isUnespEmail } from '@cacic/shared-utils';

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
export class UserVerificationService {
  private readonly logger = new Logger(UserVerificationService.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly pdfProcessingService: PdfProcessingService,
  ) {}

  /**
   * Check if user is an external user (no @unesp.br email)
   */
  async isExternalUser(userId: string): Promise<boolean> {
    const user = await this.keycloakService.getUserBasicInfo(userId);
    if (!user?.email) {
      throw new Error('Não foi possível determinar o tipo de vínculo do usuário');
    }

    return !isUnespEmail(user.email);
  }

  /**
   * Get user's full name from Keycloak
   */
  async getUserFullname(userId: string): Promise<string> {
    const attributes = await this.keycloakService.getUserAttributes(userId);
    const fullname = attributes?.fullName?.[0];
    if (!fullname) {
      throw new Error('Nome completo não encontrado no perfil do usuário');
    }
    return fullname;
  }

  /**
   * Verify external user (former student) by fullname matching
   */
  async verifyExternalUser(
    pdfBuffer: Buffer,
    fullname: string,
  ): Promise<{
    nameMatches: boolean;
    extractedEnrollment: string | null;
  }> {
    // Check if fullname matches
    const nameMatches = await this.pdfProcessingService.checkFullnameInPdf(pdfBuffer, fullname);

    // Extract enrollment number for egressos
    const extractedEnrollment = await this.pdfProcessingService.extractEnrollmentFromPdf(pdfBuffer, true);

    return {
      nameMatches: nameMatches && extractedEnrollment !== null,
      extractedEnrollment,
    };
  }

  async applyExternalUserVerification(userId: string, extractedEnrollment: string): Promise<void> {
    await this.keycloakService.updateUserAttributes(
      userId,
      {
        unespRole: ['egresso'],
        enrollmentNumber: [extractedEnrollment],
        externalUserVerified: ['true'],
        externalUserVerificationDate: [new Date().toISOString()],
        fullNameLocked: ['true'],
        fullNameLockedAt: [new Date().toISOString()],
      },
      { skipValidation: true },
    );
  }

  /**
   * Verify Unesp student by enrollment number and optionally fullname
   */
  async verifyUnespStudent(
    userId: string,
    pdfBuffer: Buffer,
    enrollmentNumber: string,
    fullname: string,
  ): Promise<{
    enrollmentMatches: boolean;
    fullnameMatches: boolean;
    combinedResult: boolean;
  }> {
    // Step 1: Check enrollment number in PDF
    const enrollmentMatches = await this.pdfProcessingService.checkEnrollmentInPdf(pdfBuffer, enrollmentNumber);

    // Step 2: Require the exact normalized full name as a second factor.
    const fullnameMatches = await this.pdfProcessingService.checkFullnameInPdf(pdfBuffer, fullname);

    // Both enrollment and fullname must match (or fullname check is skipped if not available)
    const combinedResult = enrollmentMatches && fullnameMatches;

    this.logger.debug('Combined verification result for Unesp user:', {
      userId,
      enrollmentMatches,
      fullnameMatches,
      fullnameProvided: true,
      combinedResult,
    });

    return {
      enrollmentMatches,
      fullnameMatches,
      combinedResult,
    };
  }

  /**
   * Set verification status in Keycloak
   */
  async setVerificationStatus(
    userId: string,
    verified: boolean,
    verificationType: 'unesp_student' | 'external_user',
    additionalData?: VerificationDetails,
  ): Promise<void> {
    try {
      await this.keycloakService.setUnespRoleVerified(userId, verified);

      if (verified) {
        await this.keycloakService.verifyUserUnespRole(userId, 'university-validation-system', 'document');
      }

      this.logger.debug('Verification status updated:', {
        userId,
        verified,
        verificationType,
        hasAdditionalData: !!additionalData,
      });
    } catch (error) {
      this.logger.error('Failed to set verification status:', error);
      throw error;
    }
  }
}
