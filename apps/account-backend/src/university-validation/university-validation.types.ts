import { AxiosInstance } from 'axios';
import { CookieJar } from 'tough-cookie';
import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export interface CaptchaSession {
  sessionId: string;
  userId?: string; // Security: tie session to authenticated user
  captchaImageBase64?: string;
  cookieJar: CookieJar;
  axiosInstance?: AxiosInstance;
  authCode?: string; // Store the auth code extracted from PDF
  enrollmentNumber?: string; // Store enrollment number for validation
  pageHtml?: string; // Store the form page HTML
  hiddenInputs?: Record<string, string>; // Store hidden form inputs
  pageUrl?: string; // Store the form page URL
  initialJSESSIONID?: string; // Track the initial JSESSIONID for debugging
  createdAt: Date; // Track when session was created for cleanup
  sessionToken?: string; // Track session token
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
  captchaCode: string;
}

export class AtomicValidationDto {
  @IsOptional()
  @IsString()
  captchaCode?: string; // Optional - if not provided, returns captcha image

  @IsString()
  @IsNotEmpty()
  sessionId: string; // Required to retrieve auth code from server-side session
}
