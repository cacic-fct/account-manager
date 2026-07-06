import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import type { StudentVerificationDocument } from '@prisma/client';
import { S3Service } from '../../common/services/s3.service';
import { Readable } from 'stream';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DocumentManagementService {
  private readonly logger = new Logger(DocumentManagementService.name);

  constructor(
    private readonly prisma: PrismaService,
    private s3Service: S3Service,
  ) {}

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
        this.logger.debug(`Deleted approved document file: ${document.s3Key}`);
      }

      await this.prisma.studentVerificationDocument.update({
        where: { id: document.id },
        data: {
          authenticationCode: null,
          s3Key: null,
          filePath: '',
        },
      });

      this.logger.debug(`Cleaned up sensitive data for approved document: ${document.id}`);
    } catch (error) {
      this.logger.error(
        `Failed to cleanup approved document ${document.id}: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
