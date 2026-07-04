import { Injectable, BadRequestException, Logger, Optional } from '@nestjs/common';
import { VerificationStatusDto } from '../dto/student-verification.dto';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { StudentVerificationDocument } from '@prisma/client';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { UnespRole } from '@cacic/shared-types';

@Injectable()
export class StatusManagementService {
  private readonly logger = new Logger(StatusManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  private async logKeycloakDrift(userId: string, document: StudentVerificationDocument | null): Promise<void> {
    try {
      const userAttributes = await this.keycloakService.getUserAttributes(userId);
      const isKeycloakVerified = userAttributes.unespRoleVerified?.[0] === 'true';
      const isDatabaseVerified = document?.status === 'approved';

      if (isKeycloakVerified !== isDatabaseVerified) {
        this.logger.warn(
          `Student verification drift detected for user ${userId}: database=${document?.status ?? 'not_submitted'}, keycloak=${isKeycloakVerified ? 'approved' : 'not_approved'}`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not compare Keycloak verification status for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  async getVerificationStatus(userId: string): Promise<VerificationStatusDto> {
    try {
      if (await this.isUndergraduateVerificationNotRequired(userId)) {
        return {
          status: 'not_required',
          undergraduateUnespRoleVerificationDisabled: true,
          isDocumentValid: true,
        };
      }

      const approvedDocument = await this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'approved' },
        orderBy: { verificationDate: 'desc' },
      });

      if (approvedDocument) {
        await this.logKeycloakDrift(userId, approvedDocument);
        return {
          status: 'approved',
          submissionDate: approvedDocument.createdAt,
          verificationDate: approvedDocument.verificationDate ?? undefined,
        };
      }

      const document = await this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });

      if (document) {
        await this.logKeycloakDrift(userId, document);
        return {
          status: 'pending',
          submissionDate: document.createdAt,
        };
      }

      const rejectedDocument = await this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'rejected' },
        orderBy: { createdAt: 'desc' },
      });

      if (rejectedDocument) {
        await this.logKeycloakDrift(userId, rejectedDocument);
        return {
          status: 'rejected',
          submissionDate: rejectedDocument.createdAt,
          verificationDate: rejectedDocument.verificationDate ?? undefined,
          rejectionReason: rejectedDocument.rejectionReason ?? undefined,
        };
      }

      await this.logKeycloakDrift(userId, null);
      return {
        status: 'not_submitted',
      };
    } catch (error) {
      this.logger.error(
        `Error getting verification status for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException('Erro ao verificar status de verificação');
    }
  }

  private async isUndergraduateVerificationNotRequired(userId: string): Promise<boolean> {
    if (!(await this.featureFlags?.isUndergraduateUnespRoleVerificationDisabled())) {
      return false;
    }

    const attributes = await this.keycloakService.getUserAttributes(userId);
    return attributes.unespRole?.includes(UnespRole.ALUNO_GRADUACAO) ?? false;
  }
}
