import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import type { StudentVerificationDocument } from '@prisma/client';
import { S3Service } from '../../common/services/s3.service';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DocumentManagementService {
  private readonly logger = new Logger(DocumentManagementService.name);
  private readonly pendingRetentionMs: number;
  private readonly rejectedRetentionMs: number;

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
    try {
      if (document.s3Key) {
        await this.s3Service.deleteFile(document.s3Key);
        this.logger.debug('Deleted approved student verification document file');
      }

      await this.prisma.studentVerificationDocument.update({
        where: { id: document.id },
        data: {
          authenticationCode: null,
          s3Key: null,
          filePath: '',
        },
      });

      this.logger.debug('Cleaned up sensitive data for approved student verification document');
    } catch (error) {
      this.logger.error('Failed to clean up approved student verification document', {
        errorType: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  @Interval(24 * 60 * 60 * 1000)
  async cleanupExpiredDocuments(): Promise<void> {
    const now = Date.now();
    const pendingCutoff = new Date(now - this.pendingRetentionMs);
    const rejectedCutoff = new Date(now - this.rejectedRetentionMs);
    const documents = await this.prisma.studentVerificationDocument.findMany({
      where: {
        s3Key: { not: null },
        OR: [
          { status: 'pending', createdAt: { lt: pendingCutoff } },
          { status: 'rejected', updatedAt: { lt: rejectedCutoff } },
        ],
      },
      orderBy: { createdAt: 'asc' },
      take: 100,
    });

    for (const document of documents) {
      await this.cleanupExpiredDocument(document).catch((error: unknown) => {
        this.logger.error('Failed to apply student verification retention', {
          errorType: error instanceof Error ? error.name : typeof error,
        });
      });
    }
  }

  private async cleanupExpiredDocument(document: StudentVerificationDocument): Promise<void> {
    if (!document.s3Key) return;

    await this.s3Service.deleteFile(document.s3Key);
    await this.prisma.$transaction(async (tx) => {
      const isPending = document.status === 'pending';
      const updated = await tx.studentVerificationDocument.updateMany({
        where: {
          id: document.id,
          status: document.status,
          s3Key: document.s3Key,
        },
        data: {
          ...(isPending && {
            status: 'rejected',
            rejectionReason: 'Prazo de análise expirado. Envie o documento novamente.',
          }),
          authenticationCode: null,
          s3Key: null,
          filePath: '',
        },
      });

      if (isPending && updated.count > 0) {
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
    });
  }

  private readRetentionMs(configService: ConfigService, name: string, fallbackDays: number): number {
    const configuredDays = Number.parseInt(configService.get<string>(name) ?? '', 10);
    const days = Number.isFinite(configuredDays) && configuredDays > 0 ? configuredDays : fallbackDays;
    return days * 24 * 60 * 60 * 1000;
  }
}
