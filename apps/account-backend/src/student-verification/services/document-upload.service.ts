import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import type { Prisma, StudentVerificationDocument } from '@prisma/client';
import {
  UploadResponseDto,
  PdfVerificationResult,
} from '../dto/student-verification.dto';
import { S3Service } from '../../common/services/s3.service';
import { PdfProcessingService } from '../../university-validation/services/pdf-processing.service';
import { v7 as uuidv7 } from 'uuid';
import { PdfVerificationService } from './pdf-verification.service';
import { PrismaService } from '../../prisma/prisma.service';

interface LogMetadata {
  fileName: string;
  fileSize: number;
  mimeType: string;
  authenticationCode: string | null;
  isManualFallback: boolean;
}

@Injectable()
export class DocumentUploadService {
  private readonly logger = new Logger(DocumentUploadService.name);
  private readonly uploadLockScope = 'student-verification-upload';

  constructor(
    private readonly prisma: PrismaService,
    private s3Service: S3Service,
    private pdfProcessingService: PdfProcessingService,
    private pdfVerificationService: PdfVerificationService,
  ) {}

  private fixFilenameEncoding(originalFilename: string): string {
    try {
      if (
        originalFilename.includes('Ã') ||
        /[^\u0020-\u007F]/.test(originalFilename)
      ) {
        const fixed = Buffer.from(originalFilename, 'latin1').toString('utf8');
        if (!fixed.includes('�') && fixed.length > 0) {
          return fixed;
        }
      }

      return originalFilename;
    } catch (error) {
      this.logger.warn(
        `Error fixing filename encoding: ${
          error instanceof Error ? error.message : String(error)
        }`,
        'fixFilenameEncoding',
      );
      return originalFilename;
    }
  }

  private async lockUserUpload(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    await tx.$queryRaw`
      SELECT pg_advisory_xact_lock(
        hashtext(${this.uploadLockScope}),
        hashtext(${userId})
      )
    `;
  }

  private rejectActiveDocument(
    existingDocument: StudentVerificationDocument | null,
  ): void {
    if (existingDocument?.status === 'approved') {
      throw new BadRequestException('Você já possui um documento verificado.');
    }

    if (existingDocument?.status === 'pending') {
      throw new BadRequestException(
        'Você já possui um documento aguardando verificação.',
      );
    }
  }

  private async cleanupUploadedFileAfterFailure(
    s3Key: string,
    originalError: unknown,
  ): Promise<never> {
    try {
      await this.s3Service.deleteFile(s3Key);
      this.logger.warn(
        `Deleted student verification upload after failed persistence: ${s3Key}`,
      );
    } catch (cleanupError) {
      this.logger.error(
        `Failed to delete orphaned student verification upload ${s3Key}: ${
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError)
        }`,
        cleanupError instanceof Error ? cleanupError.stack : undefined,
      );
    }

    if (originalError instanceof Error) {
      throw originalError;
    }

    throw new BadRequestException('Erro ao salvar documento de verificação.');
  }

  async uploadDocument(
    file: Express.Multer.File,
    userId: string,
    isManualFallback = false,
  ): Promise<UploadResponseDto> {
    const allowedMimeTypes = ['application/pdf'];

    if (isManualFallback) {
      allowedMimeTypes.push('text/plain');
    }

    if (!allowedMimeTypes.includes(file.mimetype)) {
      throw new BadRequestException('Tipo de arquivo não suportado. Use PDF.');
    }

    const maxSize = 10 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new BadRequestException(
        'Arquivo muito grande. Tamanho máximo: 10MB.',
      );
    }

    const existingDocument =
      await this.prisma.studentVerificationDocument.findFirst({
        where: {
          userId,
          status: { in: ['pending', 'approved'] },
        },
      });

    this.rejectActiveDocument(existingDocument);

    const fileExtension = file.originalname.split('.').pop() || '';
    const storedFileName = `${uuidv7()}.${fileExtension}`;
    const s3Key = this.s3Service.generateFileKey(
      'student-verification',
      userId,
      storedFileName,
    );

    this.logger.debug(
      `Uploading student verification document to S3 (userId=${userId}, manualFallback=${isManualFallback}, mimeType=${file.mimetype})`,
    );

    const uploadResult = await this.s3Service.uploadFile(
      s3Key,
      file.buffer,
      file.mimetype,
      {
        userId,
        originalFileName: file.originalname,
        uploadedAt: new Date().toISOString(),
      },
    );

    this.logger.debug('S3 upload completed', uploadResult);

    let pdfVerificationResult: PdfVerificationResult | null = null;
    let extractedAuthCode: string | null = null;

    if (file.mimetype === 'application/pdf') {
      try {
        extractedAuthCode =
          await this.pdfProcessingService.extractAuthCodeFromPdf(file.buffer);

        try {
          pdfVerificationResult =
            await this.pdfVerificationService.verifyPdfDocumentFromBuffer(
              file.buffer,
            );
        } catch (verificationError: unknown) {
          this.logger.error(
            `PDF buffer verification failed: ${
              verificationError instanceof Error
                ? verificationError.message
                : String(verificationError)
            }`,
            verificationError instanceof Error
              ? verificationError.stack
              : undefined,
          );
          pdfVerificationResult = {
            success: false,
            error:
              verificationError instanceof Error
                ? verificationError.message
                : 'Falha na verificação do documento PDF',
          };
        }
      } catch (error: unknown) {
        this.logger.error(
          `PDF verification failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          error instanceof Error ? error.stack : undefined,
        );
        pdfVerificationResult = {
          success: false,
          error:
            error instanceof Error
              ? error.message
              : 'Falha na extração do código de autenticidade',
        };
      }
    }

    let initialStatus: 'pending' | 'rejected' = 'pending';
    let rejectionReason: string | null = null;

    if (pdfVerificationResult && !pdfVerificationResult.success) {
      initialStatus = 'rejected';
      rejectionReason = `Erro na verificação do PDF: ${pdfVerificationResult.error}`;
    } else if (
      pdfVerificationResult?.data &&
      !pdfVerificationResult.data.isValid
    ) {
      initialStatus = 'rejected';
      rejectionReason =
        pdfVerificationResult.data.error || 'Documento inválido ou expirado';
    }

    const createData: Prisma.StudentVerificationDocumentCreateInput = {
      userId,
      originalFileName: this.fixFilenameEncoding(file.originalname),
      storedFileName,
      filePath: s3Key,
      s3Key,
      mimeType: file.mimetype,
      fileSize: uploadResult.size,
      status: initialStatus,
      rejectionReason,
      authenticationCode:
        extractedAuthCode || pdfVerificationResult?.data?.authCode || null,
      documentEmissionDate: pdfVerificationResult?.data?.emissionDate
        ? new Date(pdfVerificationResult.data.emissionDate)
        : null,
      documentExpirationDate: pdfVerificationResult?.data?.expirationDate
        ? new Date(pdfVerificationResult.data.expirationDate)
        : null,
      isDocumentValid: pdfVerificationResult?.data?.isValid ?? null,
    };

    const logMetadata: LogMetadata = {
      fileName: file.originalname,
      fileSize: file.size,
      mimeType: file.mimetype,
      authenticationCode: extractedAuthCode,
      isManualFallback,
    };

    let savedDocument: StudentVerificationDocument;

    try {
      savedDocument = await this.prisma.$transaction(async (tx) => {
        await this.lockUserUpload(tx, userId);

        const activeDocument = await tx.studentVerificationDocument.findFirst({
          where: {
            userId,
            status: { in: ['pending', 'approved'] },
          },
        });

        this.rejectActiveDocument(activeDocument);

        const createdDocument = await tx.studentVerificationDocument.create({
          data: createData,
        });

        await tx.studentVerificationLog.create({
          data: {
            documentId: createdDocument.id,
            userId,
            action:
              initialStatus === 'rejected' ? 'automated_rejected' : 'upload',
            performedBy: initialStatus === 'rejected' ? 'automated' : 'system',
            reason: rejectionReason,
            metadata: logMetadata as unknown as Prisma.InputJsonValue,
          },
        });

        return createdDocument;
      });
    } catch (error) {
      return await this.cleanupUploadedFileAfterFailure(s3Key, error);
    }

    if (initialStatus === 'rejected') {
      this.logger.warn(
        `Document automatically rejected for user ${userId}: ${rejectionReason}`,
      );
    } else {
      this.logger.log(`Document uploaded successfully for user ${userId}`);
    }

    const message =
      initialStatus === 'rejected'
        ? `Documento rejeitado automaticamente: ${rejectionReason}`
        : 'Documento enviado com sucesso! Aguarde a verificação.';

    return {
      message,
      documentId: savedDocument.id,
      status: savedDocument.status,
      authenticationCode: extractedAuthCode || undefined,
      extractedName: undefined,
    };
  }
}
