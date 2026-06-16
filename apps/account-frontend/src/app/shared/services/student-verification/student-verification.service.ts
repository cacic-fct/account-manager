import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import type {
  StudentVerificationDocument,
  StudentVerificationStatusResponse,
  StudentVerificationUpdateResponse,
  StudentVerificationUploadResponse,
} from '@cacic/shared-types';
import { getApiBaseUrl } from '../../utils/api-url.util';

export type UploadResponse = StudentVerificationUploadResponse;
export type VerificationStatus = StudentVerificationStatusResponse;
export type StudentDocument = StudentVerificationDocument;
export type VerificationUpdateResponse = StudentVerificationUpdateResponse;

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
