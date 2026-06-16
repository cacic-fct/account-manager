export type StudentVerificationDocumentStatus =
  | 'pending'
  | 'approved'
  | 'rejected';

export type StudentVerificationStatus =
  | StudentVerificationDocumentStatus
  | 'not_submitted';

export interface StudentVerificationUploadResponse {
  message: string;
  documentId: string;
  status: StudentVerificationDocumentStatus;
  authenticationCode?: string;
  extractedName?: string;
}

export interface StudentVerificationStatusResponse {
  status: StudentVerificationStatus;
  submissionDate?: Date;
  verificationDate?: Date;
  rejectionReason?: string;
  authenticationCode?: string;
  extractedName?: string;
  documentEmissionDate?: Date;
  documentExpirationDate?: Date;
  isDocumentValid?: boolean;
}

export interface StudentVerificationDocument {
  id: string;
  userId: string;
  email: string;
  fullName?: string;
  originalFileName: string;
  status: StudentVerificationDocumentStatus;
  createdAt: Date;
  verificationDate?: Date;
  rejectionReason?: string;
  authenticationCode?: string;
  extractedName?: string;
}

export interface StudentVerificationUpdateRequest {
  status: 'approved' | 'rejected';
  rejectionReason?: string;
}

export interface StudentVerificationUpdateResponse {
  message: string;
  status: StudentVerificationDocumentStatus;
}
