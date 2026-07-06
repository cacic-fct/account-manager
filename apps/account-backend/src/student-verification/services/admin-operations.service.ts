import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import type { Prisma, StudentVerificationDocument } from '@prisma/client';
import { UpdateVerificationStatusDto } from '../dto/student-verification.dto';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { DocumentManagementService } from './document-management.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AdminOperationsService {
  private readonly logger = new Logger(AdminOperationsService.name);
  private readonly verificationLockScope = 'student-verification-document';
  private readonly verificationUserLockScope = 'student-verification-user';
  private readonly transactionOptions = {
    maxWait: 5000,
    timeout: 30000,
  };

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
    private documentManagementService: DocumentManagementService,
  ) {}

  async getAllPendingDocuments(): Promise<(StudentVerificationDocument & { email?: string; fullName?: string })[]> {
    const documents = await this.prisma.studentVerificationDocument.findMany({
      where: { status: 'pending' },
      orderBy: { createdAt: 'asc' },
    });

    const documentsWithUserInfo = await Promise.all(
      documents.map(async (document) => {
        try {
          const userAttributes = await this.keycloakService.getUserAttributes(document.userId);
          const userBasicInfo = await this.keycloakService.getUserBasicInfo(document.userId);

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

  private async lockDocumentTransition(tx: Prisma.TransactionClient, documentId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${this.verificationLockScope}),
        hashtext(${documentId})
      )
    `;
  }

  private async lockUserTransition(tx: Prisma.TransactionClient, userId: string): Promise<void> {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${this.verificationUserLockScope}),
        hashtext(${userId})
      )
    `;
  }

  private normalizeRejectionReason(updateDto: UpdateVerificationStatusDto): string | null {
    if (updateDto.status !== 'rejected') {
      return null;
    }

    const rejectionReason = updateDto.rejectionReason?.trim();

    if (!rejectionReason) {
      throw new BadRequestException('Informe o motivo da rejeição do documento.');
    }

    return rejectionReason;
  }

  private async getPendingDocumentFromTransaction(
    tx: Prisma.TransactionClient,
    documentId: string,
  ): Promise<StudentVerificationDocument> {
    const document = await tx.studentVerificationDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Documento não encontrado.');
    }

    if (document.status !== 'pending') {
      throw new BadRequestException('Apenas documentos pendentes podem ser verificados.');
    }

    return document;
  }

  private async hasApprovedDocumentForUser(tx: Prisma.TransactionClient, userId: string): Promise<boolean> {
    const approvedDocument = await tx.studentVerificationDocument.findFirst({
      where: {
        userId,
        status: 'approved',
      },
    });

    return Boolean(approvedDocument);
  }

  private async persistVerificationTransitionInTransaction(
    tx: Prisma.TransactionClient,
    document: StudentVerificationDocument,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
    rejectionReason: string | null,
  ): Promise<StudentVerificationDocument> {
    const updated = await tx.studentVerificationDocument.update({
      where: { id: document.id },
      data: {
        status: updateDto.status,
        verifiedBy,
        verificationDate: new Date(),
        rejectionReason,
      },
    });

    const logMetadata: Prisma.InputJsonValue = {
      previousStatus: document.status,
      verificationDate: updated.verificationDate?.toISOString() ?? null,
    };

    await tx.studentVerificationLog.create({
      data: {
        documentId: document.id,
        userId: document.userId,
        action: updateDto.status,
        performedBy: verifiedBy,
        reason: rejectionReason,
        metadata: logMetadata,
      },
    });

    return updated;
  }

  private async persistVerificationTransition(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
    rejectionReason: string | null,
  ): Promise<StudentVerificationDocument> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockDocumentTransition(tx, documentId);

      const document = await this.getPendingDocumentFromTransaction(tx, documentId);
      await this.lockUserTransition(tx, document.userId);

      return this.persistVerificationTransitionInTransaction(tx, document, updateDto, verifiedBy, rejectionReason);
    }, this.transactionOptions);
  }

  private async markUserAsVerifiedInKeycloak(userId: string): Promise<void> {
    try {
      await this.keycloakService.updateUserAttributes(userId, {
        unespRoleVerified: 'true',
      });
      this.logger.debug(`Set unespRoleVerified=true for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to set unespRoleVerified for user ${userId}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new BadRequestException(
        'Não foi possível marcar o usuário como verificado no CACiC SSO. A aprovação foi cancelada.',
      );
    }
  }

  private async rollbackKeycloakApproval(userId: string): Promise<void> {
    try {
      await this.keycloakService.updateUserAttributes(userId, {
        unespRoleVerified: 'false',
      });
      this.logger.warn(`Rolled back unespRoleVerified=true for user ${userId} after database approval failed.`);
    } catch (error) {
      this.logger.error(
        `Failed to roll back unespRoleVerified for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private async undoKeycloakApprovalIfNoApprovedDocument(userId: string): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await this.lockUserTransition(tx, userId);
        const hasApprovedDocument = await this.hasApprovedDocumentForUser(tx, userId);

        if (hasApprovedDocument) {
          this.logger.warn(
            `Skipped unespRoleVerified rollback for user ${userId} because an approved document already exists.`,
          );
          return;
        }

        await this.rollbackKeycloakApproval(userId);
      }, this.transactionOptions);
    } catch (error) {
      this.logger.warn(
        `Could not check approved documents before unespRoleVerified rollback for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async approveVerificationTransition(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
    rejectionReason: string | null,
  ): Promise<StudentVerificationDocument> {
    let approvalUserId: string | null = null;
    let keycloakApprovalApplied = false;
    let hadApprovedDocumentBeforeApproval = false;
    let rollbackHandled = false;

    try {
      return await this.prisma.$transaction(async (tx) => {
        await this.lockDocumentTransition(tx, documentId);

        const document = await this.getPendingDocumentFromTransaction(tx, documentId);
        approvalUserId = document.userId;

        await this.lockUserTransition(tx, document.userId);
        hadApprovedDocumentBeforeApproval = await this.hasApprovedDocumentForUser(tx, document.userId);

        await this.markUserAsVerifiedInKeycloak(document.userId);
        keycloakApprovalApplied = true;

        try {
          return await this.persistVerificationTransitionInTransaction(
            tx,
            document,
            updateDto,
            verifiedBy,
            rejectionReason,
          );
        } catch (error) {
          if (!hadApprovedDocumentBeforeApproval) {
            await this.rollbackKeycloakApproval(document.userId);
          }
          rollbackHandled = true;
          throw error;
        }
      }, this.transactionOptions);
    } catch (error) {
      if (approvalUserId && keycloakApprovalApplied && !hadApprovedDocumentBeforeApproval && !rollbackHandled) {
        await this.undoKeycloakApprovalIfNoApprovedDocument(approvalUserId);
      }

      throw error;
    }
  }

  private async rejectVerificationTransition(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
    rejectionReason: string | null,
  ): Promise<StudentVerificationDocument> {
    return this.persistVerificationTransition(documentId, updateDto, verifiedBy, rejectionReason);
  }

  async updateVerificationStatus(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
  ): Promise<StudentVerificationDocument> {
    const rejectionReason = this.normalizeRejectionReason(updateDto);

    let updatedDocument: StudentVerificationDocument;

    if (updateDto.status === 'approved') {
      updatedDocument = await this.approveVerificationTransition(documentId, updateDto, verifiedBy, rejectionReason);
    } else {
      updatedDocument = await this.rejectVerificationTransition(documentId, updateDto, verifiedBy, rejectionReason);
    }

    if (updateDto.status === 'approved') {
      await this.documentManagementService.cleanupApprovedDocument(updatedDocument);
      this.logger.debug(
        `Approved document ${updatedDocument.id} for user ${updatedDocument.userId}. Cleanup completed by ${verifiedBy}.`,
      );
    } else if (updateDto.status === 'rejected') {
      this.logger.warn(
        `Rejected document ${updatedDocument.id} for user ${updatedDocument.userId}. Reason: ${rejectionReason}`,
      );
    }

    return updatedDocument;
  }
}
