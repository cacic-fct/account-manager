import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type {
  BulkUpdatePrivacySettings,
  CookieBannerStatus,
  PrivacySetting,
  UpdatePrivacySetting,
} from '@cacic/shared-types';
import { getApiBaseUrl } from '../../utils/api-url.util';

@Injectable({
  providedIn: 'root',
})
export class PrivacyApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);

  getPrivacySettings(): Observable<PrivacySetting> {
    return this.http.get<PrivacySetting>(`${this.baseUrl}/privacy/settings`, {
      withCredentials: true,
    });
  }

  updatePrivacySetting(
    settingType: string,
    dto: UpdatePrivacySetting,
  ): Observable<PrivacySetting> {
    return this.http.put<PrivacySetting>(
      `${this.baseUrl}/privacy/settings/${settingType}`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  bulkUpdatePrivacySettings(
    dto: BulkUpdatePrivacySettings,
  ): Observable<PrivacySetting> {
    return this.http.put<PrivacySetting>(
      `${this.baseUrl}/privacy/settings`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  getCookieBannerStatus(): Observable<CookieBannerStatus> {
    return this.http.get<CookieBannerStatus>(
      `${this.baseUrl}/privacy/cookie-banner/status`,
      {
        withCredentials: true,
      },
    );
  }

  acceptCookieBanner(): Observable<PrivacySetting> {
    return this.http.post<PrivacySetting>(
      `${this.baseUrl}/privacy/cookie-banner/accept`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  initializePrivacySettings(): Observable<PrivacySetting> {
    return this.http.post<PrivacySetting>(
      `${this.baseUrl}/privacy/initialize`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getPrivacyDirectives(): Observable<unknown> {
    return this.http.get(`${this.baseUrl}/privacy-directives`, {
      withCredentials: true,
      observe: 'response',
    });
  }

  getPrivacyPreferences(token: string): Observable<Record<string, boolean>> {
    return this.http.get<Record<string, boolean>>(
      `${this.baseUrl}/privacy/preferences`,
      {
        params: { token },
      },
    );
  }
}
