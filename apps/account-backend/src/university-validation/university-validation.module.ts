import { Module } from '@nestjs/common';
import { UniversityValidationController } from './university-validation.controller';
import { UniversityValidationService } from './university-validation.service';
import { PdfProcessingService } from './services/pdf-processing.service';
import { UserVerificationService } from './services/user-verification.service';
import { SessionManagementService } from './services/session-management.service';
import { DocumentValidationService } from './services/document-validation.service';
import { HtmlResponseService } from './services/html-response.service';
import { CaptchaManagementService } from './services/captcha-management.service';
import { AuthModule } from '../auth/auth.module';
import { StudentVerificationModule } from '../student-verification/student-verification.module';
import { CaptchaService } from './services/captcha.service';
import { CommonModule } from '../common/common.module';
import { ExternalVerificationResilienceService } from './services/external-verification-resilience.service';
import { UniversityVerificationRateLimitService } from './services/university-verification-rate-limit.service';
import { RedisModule } from '../redis/redis.module';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [AuthModule, StudentVerificationModule, CommonModule, RedisModule, ConfigModule],
  controllers: [UniversityValidationController],
  providers: [
    UniversityValidationService,
    PdfProcessingService,
    UserVerificationService,
    SessionManagementService,
    DocumentValidationService,
    HtmlResponseService,
    CaptchaManagementService,
    CaptchaService,
    ExternalVerificationResilienceService,
    UniversityVerificationRateLimitService,
  ],
  exports: [
    UniversityValidationService,
    PdfProcessingService,
    UserVerificationService,
    SessionManagementService,
    DocumentValidationService,
    HtmlResponseService,
    CaptchaManagementService,
    CaptchaService,
    ExternalVerificationResilienceService,
    UniversityVerificationRateLimitService,
  ],
})
export class UniversityValidationModule {}
