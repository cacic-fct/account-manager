import { AxiosInstance } from 'axios';
import { CookieJar } from 'tough-cookie';
import { IsString, IsNotEmpty, IsOptional, IsUUID, Matches, MaxLength } from 'class-validator';

export interface CaptchaSession {
  sessionId: string;
  userId?: string; // Security: tie session to authenticated user
  captchaImageBase64?: string;
  cookieJar: CookieJar;
  axiosInstance?: AxiosInstance;
  authCode?: string; // Store the auth code extracted from PDF
  enrollmentNumber?: string; // Store enrollment number for validation
  hiddenInputs?: Record<string, string>; // Store hidden form inputs
  pageUrl?: string; // Store the form page URL
  formActionUrl?: string; // Store the validated action from the provider form
  createdAt: Date; // Track when session was created for cleanup
}

interface ValidationData {
  enrollmentNumber?: string;
  enrollmentVerified?: boolean;
  authCode?: string;
  validationTimestamp?: string;
  responseType?: 'pdf' | 'html';
  isExternalUser?: boolean;
  extractedEnrollment?: string;
  pdfSize?: number;
  expectedEnrollment?: string;
  foundInDocument?: boolean;
  verificationType?: 'external_user' | 'unesp_student';
}

export interface ValidationResult {
  success: boolean;
  isValid?: boolean;
  pdfUrl?: string;
  pdfContent?: Buffer;
  error?: string;
  needsNewCaptcha?: boolean;
  data?: ValidationData; // Additional data for successful validations
  fallbackToManual?: boolean; // Indicates if fallback to manual approval was triggered
  manualApprovalId?: string; // ID of the created manual approval request
}

export class GetCaptchaDto {
  authCode?: string;
}

export class ValidateDocumentDto {
  @IsString()
  @IsNotEmpty()
  captchaCode!: string;
}

export class AtomicValidationDto {
  @IsOptional()
  @IsString()
  @MaxLength(16)
  @Matches(/^[A-Za-z0-9]+$/)
  captchaCode?: string; // Optional - if not provided, returns captcha image

  @IsString()
  @IsNotEmpty()
  @IsUUID('4')
  sessionId!: string; // Required to retrieve auth code from server-side session
}

export class RefreshCaptchaDto {
  @IsString()
  @IsNotEmpty()
  @IsUUID('4')
  sessionId!: string;
}
