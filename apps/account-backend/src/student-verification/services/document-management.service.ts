import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { StudentVerificationDocument } from '@prisma/client';
import { S3Service } from '../../common/services/s3.service';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';
import { randomUUID } from 'crypto';

@Injectable()
export class DocumentManagementService {
  private readonly logger = new Logger(DocumentManagementService.name);
  private readonly pendingRetentionMs: number;
  private readonly rejectedRetentionMs: number;
  private readonly cleanupClaimLeaseMs = 15 * 60 * 1000;
  private readonly cleanupClaimPrefix = 'retention-policy:';
  private readonly cleanupPageSize = 100;
  private readonly cleanupMaxDocumentsPerRun = 1_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly s3Service: S3Service,
    configService: ConfigService,
  ) {
    this.pendingRetentionMs = this.readRetentionMs(configService, 'STUDENT_VERIFICATION_PENDING_RETENTION_DAYS', 30);
    this.rejectedRetentionMs = this.readRetentionMs(configService, 'STUDENT_VERIFICATION_REJECTED_RETENTION_DAYS', 7);
  }

  async getDocumentFile(documentId: string): Promise<{
    stream: Readable;
    mimeType: string;
    originalFileName: string;
  }> {
    const document = await this.prisma.studentVerificationDocument.findUnique({
      where: { id: documentId },
    });

    if (!document) {
      throw new NotFoundException('Documento não encontrado.');
    }

    if (!document.s3Key) {
      throw new NotFoundException('Arquivo não encontrado no sistema.');
    }

    try {
      const { stream } = await this.s3Service.downloadFile(document.s3Key);

      return {
        stream,
        mimeType: document.mimeType,
        originalFileName: document.originalFileName,
      };
    } catch {
      throw new NotFoundException('Arquivo não pôde ser baixado do servidor.');
    }
  }

  async cleanupApprovedDocument(document: StudentVerificationDocument): Promise<void> {
    await this.cleanupDocumentStorage(document);
    this.logger.debug('Cleaned up sensitive data for approved student verification document');
  }

  @Interval(24 * 60 * 60 * 1000)
  async cleanupExpiredDocuments(): Promise<void> {
    const now = Date.now();
    const pendingCutoff = new Date(now - this.pendingRetentionMs);
    const rejectedCutoff = new Date(now - this.rejectedRetentionMs);
    const processedIds: string[] = [];
    let attempted = 0;
    let cleaned = 0;
    let failed = 0;

    while (attempted < this.cleanupMaxDocumentsPerRun) {
      const documents = await this.prisma.studentVerificationDocument.findMany({
        where: {
          s3Key: { not: null },
          ...(processedIds.length > 0 ? { id: { notIn: processedIds } } : {}),
          OR: [
            { status: 'pending', createdAt: { lt: pendingCutoff } },
            { status: 'rejected', updatedAt: { lt: rejectedCutoff } },
            // Approved files are normally removed immediately after approval; retain the row as a retry obligation.
            { status: 'approved' },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: Math.min(this.cleanupPageSize, this.cleanupMaxDocumentsPerRun - attempted),
      });

      const newDocuments = documents.filter((document) => !processedIds.includes(document.id));
      if (newDocuments.length === 0) {
        break;
      }
      processedIds.push(...newDocuments.map((document) => document.id));

      for (const document of newDocuments) {
        attempted += 1;
        try {
          const didClean = await this.cleanupExpiredDocument(document);
          if (didClean) {
            cleaned += 1;
          }
        } catch (error: unknown) {
          failed += 1;
          this.logger.error('Failed to apply student verification retention', {
            documentId: document.id,
            errorType: error instanceof Error ? error.name : typeof error,
          });
        }
      }
    }

    if (failed > 0) {
      this.logger.warn(
        `Student verification retention attempted ${attempted} document(s): ${cleaned} cleaned, ${failed} retained for retry`,
      );
    }
  }

  private async cleanupExpiredDocument(document: StudentVerificationDocument): Promise<boolean> {
    return this.cleanupDocumentStorage(document);
  }

  private async cleanupDocumentStorage(document: StudentVerificationDocument): Promise<boolean> {
    if (!document.s3Key) {
      await this.prisma.studentVerificationDocument.update({
        where: { id: document.id },
        data: { authenticationCode: null, s3Key: null, filePath: '' },
      });
      return true;
    }

    const claim = await this.claimDocumentForCleanup(document);
    if (!claim) {
      return false;
    }

    // The claim is durable in verifiedBy until both the object and database reference are gone.
    // If storage fails, the row remains queryable and the next run can reclaim it after the lease.
    await this.s3Service.deleteFile(document.s3Key);

    const finalized = await this.prisma.$transaction(async (tx) => {
      return tx.studentVerificationDocument.updateMany({
        where: {
          id: document.id,
          status: claim.status,
          s3Key: document.s3Key,
          verifiedBy: claim.marker,
        },
        data: {
          authenticationCode: null,
          s3Key: null,
          filePath: '',
          verifiedBy: claim.originalVerifiedBy,
          ...(document.status === 'pending' && {
            rejectionReason: 'Prazo de análise expirado. Envie o documento novamente.',
          }),
        },
      });
    });

    if (finalized.count === 0) {
      throw new Error(`Document ${document.id} changed before retention cleanup was finalized`);
    }

    return true;
  }

  private async claimDocumentForCleanup(document: StudentVerificationDocument): Promise<{
    marker: string;
    status: StudentVerificationDocument['status'];
    originalVerifiedBy: string | null;
  } | null> {
    const existingClaim = this.parseCleanupClaim(document.verifiedBy);
    if (existingClaim && Date.now() - existingClaim.createdAt < this.cleanupClaimLeaseMs) {
      return null;
    }

    const originalVerifiedBy = existingClaim?.originalVerifiedBy ?? document.verifiedBy;
    const encodedOriginal = Buffer.from(originalVerifiedBy ?? '', 'utf8').toString('base64url');
    const marker = `${this.cleanupClaimPrefix}${Date.now()}:${randomUUID()}:${encodedOriginal}`;
    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.studentVerificationDocument.updateMany({
        where: {
          id: document.id,
          status: document.status,
          s3Key: document.s3Key,
          verifiedBy: document.verifiedBy,
        },
        data: {
          verifiedBy: marker,
          ...(document.status === 'pending' && {
            status: 'rejected',
            rejectionReason: 'Prazo de análise expirado. Envie o documento novamente.',
          }),
        },
      });

      if (document.status === 'pending' && result.count > 0) {
        await tx.studentVerificationLog.create({
          data: {
            documentId: document.id,
            userId: document.userId,
            action: 'rejected',
            performedBy: 'retention-policy',
            reason: 'Prazo de retenção do documento pendente expirado.',
          },
        });
      }

      return result;
    });

    if (updated.count === 0) {
      return null;
    }

    return {
      marker,
      status: document.status === 'pending' ? 'rejected' : document.status,
      originalVerifiedBy,
    };
  }

  private parseCleanupClaim(value: string | null): { createdAt: number; originalVerifiedBy: string | null } | null {
    if (!value?.startsWith(this.cleanupClaimPrefix)) {
      return null;
    }

    const [, , encodedOriginal] = value.slice(this.cleanupClaimPrefix.length).split(':');
    const createdAt = Number(value.slice(this.cleanupClaimPrefix.length).split(':', 1)[0]);
    if (!Number.isFinite(createdAt)) {
      return null;
    }

    try {
      return {
        createdAt,
        originalVerifiedBy: encodedOriginal ? Buffer.from(encodedOriginal, 'base64url').toString('utf8') || null : null,
      };
    } catch {
      return { createdAt, originalVerifiedBy: null };
    }
  }

  private readRetentionMs(configService: ConfigService, name: string, fallbackDays: number): number {
    const configuredDays = Number.parseInt(configService.get<string>(name) ?? '', 10);
    const days = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : fallbackDays;
    return days * 24 * 60 * 60 * 1000;
  }
}
