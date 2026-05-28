import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { VerificationStatusDto } from '../dto/student-verification.dto';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class StatusManagementService {
  private readonly logger = new Logger(StatusManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
  ) {}

  async getVerificationStatus(userId: string): Promise<VerificationStatusDto> {
    try {
      const userAttributes =
        await this.keycloakService.getUserAttributes(userId);
      const isVerified = userAttributes.unespRoleVerified?.[0] === 'true';

      if (isVerified) {
        const approvedDocument =
          await this.prisma.studentVerificationDocument.findFirst({
            where: { userId, status: 'approved' },
            orderBy: { verificationDate: 'desc' },
          });

        return {
          status: 'approved',
          submissionDate: approvedDocument?.createdAt,
          verificationDate: approvedDocument?.verificationDate ?? undefined,
        };
      }

      const document = await this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'pending' },
        orderBy: { createdAt: 'desc' },
      });

      if (document) {
        return {
          status: 'pending',
          submissionDate: document.createdAt,
        };
      }

      const rejectedDocument =
        await this.prisma.studentVerificationDocument.findFirst({
          where: { userId, status: 'rejected' },
          orderBy: { createdAt: 'desc' },
        });

      if (rejectedDocument) {
        return {
          status: 'rejected',
          submissionDate: rejectedDocument.createdAt,
          verificationDate: rejectedDocument.verificationDate ?? undefined,
          rejectionReason: rejectedDocument.rejectionReason ?? undefined,
        };
      }

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
}
