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
import { ConfigModule } from '@nestjs/config';
import { RedisModule } from '../redis/redis.module';
import { StudentVerificationRateLimitService } from './services/student-verification-rate-limit.service';

@Module({
  imports: [
    MulterModule.register({
      limits: {
        fileSize: 10 * 1024 * 1024,
      },
    }),
    AuthModule,
    CommonModule,
    ConfigModule,
    RedisModule,
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
    StudentVerificationRateLimitService,
  ],
  exports: [StudentVerificationService],
})
export class StudentVerificationModule {}
