import { IsEnum, IsOptional, IsString } from 'class-validator';

export class UploadResponseDto {
  message: string;
  documentId: string;
  status: 'pending' | 'approved' | 'rejected';
  authenticationCode?: string;
  extractedName?: string;
}

export class VerificationStatusDto {
  status: 'pending' | 'approved' | 'rejected' | 'not_submitted';
  submissionDate?: Date;
  verificationDate?: Date;
  rejectionReason?: string;
  authenticationCode?: string;
  extractedName?: string;
  documentEmissionDate?: Date;
  documentExpirationDate?: Date;
  isDocumentValid?: boolean;
}

export class UpdateVerificationStatusDto {
  @IsEnum(['approved', 'rejected'])
  status: 'approved' | 'rejected';

  @IsOptional()
  @IsString()
  rejectionReason?: string;
}

export interface PdfVerificationResult {
  success: boolean;
  data?: {
    isValid: boolean;
    authCode?: string;
    emissionDate?: string;
    expirationDate?: string;
    error?: string;
    currentDate?: string;
  };
  error?: string;
  extractedText?: string;
}
