import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  AccountLinkingStartUrl,
  AccountMergeRequest,
  ConfirmAccountMergeRequest,
  ConfirmAccountMergeResponse,
} from '@cacic/shared-types';
import { CacheService } from '../cache.service';
import { getApiBaseUrl } from '../../utils/api-url.util';
import { API_CACHE_KEYS } from './api-cache.constants';
import { AuthApiService } from './auth-api.service';

@Injectable({
  providedIn: 'root',
})
export class AccountLinkingApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);
  private authApi = inject(AuthApiService);

  startGoogleAccountLinking(): Observable<AccountLinkingStartUrl> {
    return this.http.post<AccountLinkingStartUrl>(
      `${this.baseUrl}/auth/account-linking/google/start`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getAccountMergeRequest(id: string): Observable<AccountMergeRequest> {
    return this.http.get<AccountMergeRequest>(`${this.baseUrl}/auth/account-linking/merge-requests/${id}`, {
      withCredentials: true,
    });
  }

  confirmAccountMerge(id: string, dto: ConfirmAccountMergeRequest): Observable<ConfirmAccountMergeResponse> {
    return this.http
      .post<ConfirmAccountMergeResponse>(`${this.baseUrl}/auth/account-linking/merge-requests/${id}/confirm`, dto, {
        withCredentials: true,
      })
      .pipe(
        tap(() => {
          this.authApi.clearAuthCache();
          this.cacheService.invalidate(API_CACHE_KEYS.DISCORD_STATUS);
        }),
      );
  }

  cancelAccountMerge(id: string): Observable<{ success: true }> {
    return this.http.post<{ success: true }>(
      `${this.baseUrl}/auth/account-linking/merge-requests/${id}/cancel`,
      {},
      {
        withCredentials: true,
      },
    );
  }
}
