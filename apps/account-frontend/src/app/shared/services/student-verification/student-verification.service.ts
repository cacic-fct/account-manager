import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { getApiBaseUrl } from '../../utils/api-url.util';

export interface UploadResponse {
  message: string;
  documentId: string;
  status: 'pending' | 'approved' | 'rejected';
  authenticationCode?: string;
  extractedName?: string;
}

export interface VerificationStatus {
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

export interface StudentDocument {
  id: string;
  userId: string;
  email: string;
  fullName?: string;
  originalFileName: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: Date;
  verificationDate?: Date;
  rejectionReason?: string;
  authenticationCode?: string;
  extractedName?: string;
}

export interface VerificationUpdateResponse {
  message: string;
  status: 'approved' | 'rejected';
}

@Injectable({
  providedIn: 'root',
})
export class StudentVerificationService {
  private http = inject(HttpClient);
  private readonly baseUrl = `${getApiBaseUrl()}/student-verification`;

  uploadDocument(
    file: File,
    isManualFallback = false,
  ): Observable<UploadResponse> {
    const formData = new FormData();
    formData.append('document', file);
    if (isManualFallback) {
      formData.append('isManualFallback', 'true');
    }

    return this.http.post<UploadResponse>(`${this.baseUrl}/upload`, formData, {
      withCredentials: true,
    });
  }

  getVerificationStatus(): Observable<VerificationStatus> {
    return this.http.get<VerificationStatus>(`${this.baseUrl}/status`, {
      withCredentials: true,
    });
  }

  getPendingDocuments(): Observable<StudentDocument[]> {
    return this.http.get<StudentDocument[]>(`${this.baseUrl}/admin/pending`, {
      withCredentials: true,
    });
  }

  approveDocument(documentId: string): Observable<VerificationUpdateResponse> {
    return this.http.patch<VerificationUpdateResponse>(
      `${this.baseUrl}/admin/${documentId}/verify`,
      {
        status: 'approved',
      },
      {
        withCredentials: true,
      },
    );
  }

  rejectDocument(
    documentId: string,
    reason: string,
  ): Observable<VerificationUpdateResponse> {
    return this.http.patch<VerificationUpdateResponse>(
      `${this.baseUrl}/admin/${documentId}/verify`,
      {
        status: 'rejected',
        rejectionReason: reason,
      },
      {
        withCredentials: true,
      },
    );
  }

  /**
   * Generate the URL to open Unesp verification form with pre-filled authentication code
   */
  getUniversityVerificationUrl(authenticationCode: string): string {
    const baseUrl =
      'https://sistemas.unesp.br/academico/publico/documento.action';
    return `${baseUrl}?txt_codigo_autenticidade=${encodeURIComponent(authenticationCode)}`;
  }
}
