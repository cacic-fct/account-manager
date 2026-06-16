import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import type { Prisma, StudentVerificationDocument } from '@prisma/client';
import { UpdateVerificationStatusDto } from '../dto/student-verification.dto';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { DocumentManagementService } from './document-management.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
    private documentManagementService: DocumentManagementService,
  ) {}

  async getAllPendingDocuments(): Promise<
    (StudentVerificationDocument & { email?: string; fullName?: string })[]
  > {
    const documents = await this.prisma.studentVerificationDocument.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    const documentsWithUserInfo = await Promise.all(
      documents.map(async (document) => {
        try {
          const userAttributes = await this.keycloakService.getUserAttributes(
            document.userId,
          );
          const userBasicInfo = await this.keycloakService.getUserBasicInfo(
            document.userId,
          );

          const email = userAttributes.email?.[0] || userBasicInfo?.email;
          const fullName = userAttributes.fullName?.[0];

          return {
            ...document,
            email,
            fullName,
          };
        } catch (error) {
          this.logger.error(
            `Failed to fetch user info for userId ${document.userId}: ${
              error instanceof Error ? error.message : String(error)
            }`,
            error instanceof Error ? error.stack : undefined,
          );
          return {
            ...document,
            email: 'temp@example.com',
            fullName: 'Unknown User',
          };
        }
      }),
    );

    return documentsWithUserInfo;
  }

  async updateVerificationStatus(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
  ): Promise<StudentVerificationDocument> {
    const document = await this.prisma.studentVerificationDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Documento não encontrado.');
    }

    if (document.status !== 'pending') {
      throw new BadRequestException(
        'Apenas documentos pendentes podem ser verificados.',
      );
    }

    const oldStatus = document.status;

    if (updateDto.status === 'approved') {
      try {
        await this.keycloakService.updateUserAttributes(document.userId, {
          unespRoleVerified: 'true',
        });
        this.logger.log(
          `Set unespRoleVerified=true for user ${document.userId}`,
        );
      } catch (error) {
        this.logger.error(
          `Failed to set unespRoleVerified for user ${document.userId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        throw new BadRequestException(
          'Não foi possível marcar o usuário como verificado no CACiC SSO. A aprovação foi cancelada.',
        );
      }
    }

    const updatedDocument =
      await this.prisma.studentVerificationDocument.update({
        where: { id: document.id },
        data: {
          status: updateDto.status,
          verifiedBy,
          verificationDate: new Date(),
          rejectionReason:
            updateDto.status === 'rejected'
              ? (updateDto.rejectionReason ?? null)
              : null,
        },
      });

    const logMetadata: Prisma.InputJsonValue = {
      previousStatus: oldStatus,
      verificationDate: updatedDocument.verificationDate?.toISOString() ?? null,
    };

    await this.prisma.studentVerificationLog.create({
      data: {
        documentId: document.id,
        userId: document.userId,
        action: updateDto.status,
        performedBy: verifiedBy,
        reason: updateDto.rejectionReason ?? null,
        metadata: logMetadata,
      },
    });

    if (updateDto.status === 'approved') {
      await this.documentManagementService.cleanupApprovedDocument(
        updatedDocument,
      );
      this.logger.log(
        `Approved document ${document.id} for user ${document.userId}. Cleanup completed by ${verifiedBy}.`,
      );
    } else if (updateDto.status === 'rejected') {
      this.logger.warn(
        `Rejected document ${document.id} for user ${document.userId}. Reason: ${updateDto.rejectionReason}`,
      );
    }

    return updatedDocument;
  }
}
