import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { StudentVerificationController } from './student-verification.controller';
import { StudentVerificationService } from './student-verification.service';
import { PdfProcessingService } from '../university-validation/services/pdf-processing.service';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { DocumentUploadService } from './services/document-upload.service';
import { StatusManagementService } from './services/status-management.service';
import { AdminOperationsService } from './services/admin-operations.service';
import { DocumentManagementService } from './services/document-management.service';
import { PdfVerificationService } from './services/pdf-verification.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
    AuthModule,
    CommonModule,
  ],
  controllers: [StudentVerificationController],
  providers: [
    StudentVerificationService,
    PdfProcessingService,
    DocumentUploadService,
    StatusManagementService,
    AdminOperationsService,
    DocumentManagementService,
    PdfVerificationService,
  ],
  exports: [StudentVerificationService],
})
export class StudentVerificationModule {}
