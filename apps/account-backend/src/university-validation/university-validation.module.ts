import { Module } from '@nestjs/common';
import { UniversityValidationController } from './university-validation.controller';
import { UniversityValidationService } from './university-validation.service';
import { PdfProcessingService } from './services/pdf-processing.service';
import { UserVerificationService } from './services/user-verification.service';
import { SessionManagementService } from './services/session-management.service';
import { DocumentValidationService } from './services/document-validation.service';
import { NetworkErrorService } from './services/network-error.service';
import { HtmlResponseService } from './services/html-response.service';
import { CaptchaManagementService } from './services/captcha-management.service';
import { AuthModule } from '../auth/auth.module';
import { StudentVerificationModule } from '../student-verification/student-verification.module';
import { CaptchaService } from './services/captcha.service';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [AuthModule, StudentVerificationModule, CommonModule],
  controllers: [UniversityValidationController],
  providers: [
    UniversityValidationService,
    PdfProcessingService,
    UserVerificationService,
    SessionManagementService,
    DocumentValidationService,
    NetworkErrorService,
    HtmlResponseService,
    CaptchaManagementService,
    CaptchaService,
  ],
  exports: [
    UniversityValidationService,
    PdfProcessingService,
    UserVerificationService,
    SessionManagementService,
    DocumentValidationService,
    NetworkErrorService,
    HtmlResponseService,
    CaptchaManagementService,
    CaptchaService,
  ],
})
export class UniversityValidationModule {}
