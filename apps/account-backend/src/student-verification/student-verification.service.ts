import { Injectable } from '@nestjs/common';
import {
  UploadResponseDto,
  VerificationStatusDto,
  UpdateVerificationStatusDto,
} from './dto/student-verification.dto';
import type { StudentVerificationDocument } from '@prisma/client';
import { DocumentUploadService } from './services/document-upload.service';
import { StatusManagementService } from './services/status-management.service';
import { AdminOperationsService } from './services/admin-operations.service';
import { DocumentManagementService } from './services/document-management.service';
import { Readable } from 'stream';

@Injectable()
export class StudentVerificationService {
  constructor(
    private readonly documentUploadService: DocumentUploadService,
    private readonly statusManagementService: StatusManagementService,
    private readonly adminOperationsService: AdminOperationsService,
    private readonly documentManagementService: DocumentManagementService,
  ) {}

  async uploadDocument(
    file: Express.Multer.File,
    userId: string,
    isManualFallback = false,
  ): Promise<UploadResponseDto> {
    return this.documentUploadService.uploadDocument(
      file,
      userId,
      isManualFallback,
    );
  }

  async getVerificationStatus(userId: string): Promise<VerificationStatusDto> {
    return this.statusManagementService.getVerificationStatus(userId);
  }

  async getAllPendingDocuments(): Promise<
    (StudentVerificationDocument & { email?: string; fullName?: string })[]
  > {
    return this.adminOperationsService.getAllPendingDocuments();
  }

  async updateVerificationStatus(
    documentId: string,
    updateDto: UpdateVerificationStatusDto,
    verifiedBy: string,
  ): Promise<StudentVerificationDocument> {
    return this.adminOperationsService.updateVerificationStatus(
      documentId,
      updateDto,
      verifiedBy,
    );
  }

  async getDocumentFile(documentId: string): Promise<{
    stream: Readable;
    mimeType: string;
    originalFileName: string;
  }> {
    return this.documentManagementService.getDocumentFile(documentId);
  }
}
