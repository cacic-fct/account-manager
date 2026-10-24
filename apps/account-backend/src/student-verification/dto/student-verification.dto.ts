import { IsEnum, IsNotEmpty, IsString, Matches, MaxLength, ValidateIf } from 'class-validator';
import type {
  StudentVerificationStatusResponse,
  StudentVerificationUpdateRequest,
  StudentVerificationUploadResponse,
} from '@cacic/shared-types';

export class UploadResponseDto implements StudentVerificationUploadResponse {
  message!: string;
  documentId!: string;
  status!: 'pending' | 'approved' | 'rejected';
  authenticationCode?: string;
  extractedName?: string;
}

export class VerificationStatusDto implements StudentVerificationStatusResponse {
  status!: 'pending' | 'approved' | 'rejected' | 'not_submitted' | 'not_required';
  submissionDate?: Date;
  verificationDate?: Date;
  rejectionReason?: string;
  authenticationCode?: string;
  extractedName?: string;
  documentEmissionDate?: Date;
  documentExpirationDate?: Date;
  isDocumentValid?: boolean;
  undergraduateUnespRoleVerificationDisabled?: boolean;
}

export class UpdateVerificationStatusDto implements StudentVerificationUpdateRequest {
  @IsEnum(['approved', 'rejected'], { message: 'Aprove ou rejeite o documento.' })
  status!: 'approved' | 'rejected';

  @ValidateIf((dto: UpdateVerificationStatusDto) => dto.status === 'rejected')
  @IsString({ message: 'Explique por que o documento foi rejeitado.' })
  @IsNotEmpty({ message: 'Explique por que o documento foi rejeitado.' })
  @Matches(/\S/, { message: 'Explique por que o documento foi rejeitado.' })
  @MaxLength(1000, { message: 'Motivo da rejeição: use no máximo 1000 caracteres.' })
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
