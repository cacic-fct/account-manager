import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  AdminCreateAccountMergeRequest,
  AccountLinkingStartUrl,
  AccountMergeRequest,
  AccountMergeRequestDelta,
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

  watchAccountMergeRequest(id: string): Observable<AccountMergeRequestDelta> {
    return this.createMergeRequestEventStream(`${this.baseUrl}/auth/account-linking/merge-requests/${id}/events`);
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

  createAdminAccountMerge(dto: AdminCreateAccountMergeRequest): Observable<AccountMergeRequest> {
    return this.http.post<AccountMergeRequest>(`${this.baseUrl}/admin/account-merges`, dto, {
      withCredentials: true,
    });
  }

  getAdminAccountMergeRequest(id: string): Observable<AccountMergeRequest> {
    return this.http.get<AccountMergeRequest>(`${this.baseUrl}/admin/account-merges/${id}`, {
      withCredentials: true,
    });
  }

  watchAdminAccountMergeRequest(id: string): Observable<AccountMergeRequestDelta> {
    return this.createMergeRequestEventStream(`${this.baseUrl}/admin/account-merges/${id}/events`);
  }

  confirmAdminAccountMerge(id: string, dto: ConfirmAccountMergeRequest): Observable<ConfirmAccountMergeResponse> {
    return this.http.post<ConfirmAccountMergeResponse>(`${this.baseUrl}/admin/account-merges/${id}/confirm`, dto, {
      withCredentials: true,
    });
  }

  cancelAdminAccountMerge(id: string): Observable<{ success: true }> {
    return this.http.post<{ success: true }>(`${this.baseUrl}/admin/account-merges/${id}/cancel`, {}, {
      withCredentials: true,
    });
  }

  private createMergeRequestEventStream(url: string): Observable<AccountMergeRequestDelta> {
    return new Observable((subscriber) => {
      const eventSource = new EventSource(url, { withCredentials: true });

      eventSource.onmessage = (event) => {
        try {
          subscriber.next(JSON.parse(event.data) as AccountMergeRequestDelta);
        } catch {
          subscriber.error(new Error('Invalid account merge update received'));
          eventSource.close();
        }
      };

      eventSource.onerror = () => {
        // EventSource reconnects automatically. Its next message is a current snapshot, so no polling is required.
      };

      return () => eventSource.close();
    });
  }
}
