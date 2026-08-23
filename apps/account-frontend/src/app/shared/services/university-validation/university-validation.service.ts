import { Service, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { getApiBaseUrl } from '../../utils/api-url.util';

export interface CaptchaResponse {
  captchaImage: string; // Base64 encoded image
  sessionId: string;
  // authCode removed for security - stored server-side only
  enrollmentNumber?: string; // From user profile
}

export interface AtomicValidationRequest {
  captchaCode: string;
  sessionId: string; // Required to retrieve authCode from server-side session
}

export interface AtomicValidationResponse {
  success: boolean;
  valid?: boolean;
  message?: string;
  captchaImage?: string; // Base64 encoded image for retry cases
  needsCaptcha?: boolean; // Indicates if a new captcha is needed
  error?: string;
  fallbackToManual?: boolean;
  manualApprovalId?: string;
  // authCode removed for security - never sent to frontend
  enrollmentNumber?: string; // From user profile
}

export interface CooldownStatus {
  inCooldown: boolean;
  remainingSeconds: number;
  attempts: number;
  nextCooldownSeconds: number;
}

@Service()
export class UniversityValidationService {
  private http = inject(HttpClient);
  private apiUrl = `${getApiBaseUrl()}/university-validation`;

  getCaptcha(pdfFile: File): Observable<CaptchaResponse> {
    const formData = new FormData();
    formData.append('pdfFile', pdfFile);

    return this.http.post<CaptchaResponse>(`${this.apiUrl}/captcha`, formData, {
      withCredentials: true,
    });
  }

  clearSession(sessionId: string): Observable<{ success: boolean }> {
    return this.http.post<{ success: boolean }>(
      `${this.apiUrl}/clear-session/${sessionId}`,
      {},
      { withCredentials: true },
    );
  }

  // Get captcha for atomic flow (just processes PDF and returns captcha)
  getAtomicCaptcha(pdfFile: File): Observable<{ captchaImage: string; sessionId: string }> {
    const formData = new FormData();
    formData.append('pdfFile', pdfFile);

    return this.http.post<{
      captchaImage: string;
      sessionId: string;
    }>(`${this.apiUrl}/atomic-captcha`, formData, {
      withCredentials: true,
    });
  }

  // Validate with captchaCode and sessionId (authCode retrieved from server-side session)
  validateDocumentAtomicWithData(data: {
    captchaCode: string;
    sessionId: string;
  }): Observable<AtomicValidationResponse> {
    return this.http.post<AtomicValidationResponse>(`${this.apiUrl}/validate-atomic`, data, { withCredentials: true });
  }

  // Get cooldown status for current user
  getCooldownStatus(): Observable<CooldownStatus> {
    return this.http.post<CooldownStatus>(`${this.apiUrl}/cooldown-status`, {}, { withCredentials: true });
  }

  // Refresh captcha for existing session
  refreshCaptcha(sessionId: string): Observable<{ captchaImage: string; sessionId: string }> {
    return this.http.post<{ captchaImage: string; sessionId: string }>(
      `${this.apiUrl}/refresh-captcha`,
      { sessionId },
      { withCredentials: true },
    );
  }
}
