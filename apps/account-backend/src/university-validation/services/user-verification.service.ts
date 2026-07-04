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
    try {
      const user = await this.keycloakService.getUserBasicInfo(userId);
      const email = user?.email || '';

      const isExternal = !isUnespEmail(email);

      this.logger.debug('External user check:', {
        userId,
        email,
        isExternal,
      });

      return isExternal;
    } catch (error) {
      this.logger.error('Error checking if user is external:', error);
      return false;
    }
  }

  /**
   * Get user's full name from Keycloak
   */
  async getUserFullname(userId: string): Promise<string | null> {
    try {
      const attributes = await this.keycloakService.getUserAttributes(userId);
      const fullname = attributes?.fullName?.[0] || null;

      this.logger.debug('Retrieved user fullname:', {
        userId,
        hasFullname: !!fullname,
      });

      return fullname;
    } catch (error) {
      this.logger.error('Error getting user fullname:', error);
      return null;
    }
  }

  /**
   * Verify external user (former student) by fullname matching
   */
  async verifyExternalUser(
    userId: string,
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

    if (nameMatches && extractedEnrollment) {
      try {
        // Set user as 'egresso' with extracted enrollment number
        await this.keycloakService.updateUserAttributes(
          userId,
          {
            unespRole: ['egresso'],
            enrollmentNumber: [extractedEnrollment],
            externalUserVerified: ['true'],
            externalUserVerificationDate: [new Date().toISOString()],
            // Lock fullname to prevent changes after verification
            fullNameLocked: ['true'],
            fullNameLockedAt: [new Date().toISOString()],
          },
          { skipValidation: true },
        );

        this.logger.debug('External user verified and updated', {
          userId,
          fullname,
          extractedEnrollment,
        });
      } catch (error) {
        this.logger.error('Failed to update external user attributes:', error);
      }
    }

    return { nameMatches, extractedEnrollment };
  }

  /**
   * Verify Unesp student by enrollment number and optionally fullname
   */
  async verifyUnespStudent(
    userId: string,
    pdfBuffer: Buffer,
    enrollmentNumber: string,
    fullname?: string,
  ): Promise<{
    enrollmentMatches: boolean;
    fullnameMatches: boolean;
    combinedResult: boolean;
  }> {
    // Step 1: Check enrollment number in PDF
    const enrollmentMatches = await this.pdfProcessingService.checkEnrollmentInPdf(pdfBuffer, enrollmentNumber);

    // Step 2: Check fullname in PDF if provided
    let fullnameMatches = true; // Default to true if no fullname to check

    if (fullname) {
      fullnameMatches = await this.pdfProcessingService.checkFullnameInPdf(pdfBuffer, fullname);
      this.logger.debug('Fullname verification for Unesp user:', {
        userId,
        fullname,
        fullnameMatches,
      });
    } else {
      this.logger.warn('Unesp user has no fullname for secondary verification', {
        userId,
      });
    }

    // Both enrollment and fullname must match (or fullname check is skipped if not available)
    const combinedResult = enrollmentMatches && (fullnameMatches || !fullname);

    this.logger.debug('Combined verification result for Unesp user:', {
      userId,
      enrollmentMatches,
      fullnameMatches,
      fullnameProvided: !!fullname,
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
        additionalData,
      });
    } catch (error) {
      this.logger.error('Failed to set verification status:', error);
      throw error;
    }
  }
}
