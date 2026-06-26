import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  AdminDeleteAccountRequest,
  DeleteAccountRequest,
  DeleteAccountResponse,
  LgpdRequest,
  LgpdRequestDetail,
} from '@cacic/shared-types';
import { CacheService } from '../cache.service';
import { getApiBaseUrl } from '../../utils/api-url.util';
import { API_CACHE_DURATIONS, API_CACHE_KEYS } from './api-cache.constants';

@Injectable({
  providedIn: 'root',
})
export class LgpdApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);

  createLgpdRequest(): Observable<LgpdRequestDetail> {
    return this.http
      .post<LgpdRequestDetail>(
        `${this.baseUrl}/lgpd/request`,
        {},
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          this.cacheService.invalidate(API_CACHE_KEYS.LGPD_REQUESTS);
        }),
      );
  }

  getLgpdRequests(): Observable<LgpdRequest[]> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.LGPD_REQUESTS,
      () =>
        this.http.get<LgpdRequest[]>(`${this.baseUrl}/lgpd/requests`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.LGPD_REQUESTS,
    );
  }

  getLgpdRequest(id: string): Observable<LgpdRequestDetail> {
    return this.http.get<LgpdRequestDetail>(
      `${this.baseUrl}/lgpd/request/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  downloadLgpdFile(id: string): string {
    setTimeout(() => {
      this.cacheService.invalidate(API_CACHE_KEYS.LGPD_REQUESTS);
    }, 1000);
    return `${this.baseUrl}/lgpd/download/${id}`;
  }

  deleteAccount(
    request: DeleteAccountRequest,
  ): Observable<DeleteAccountResponse> {
    return this.http
      .post<DeleteAccountResponse>(
        `${this.baseUrl}/lgpd/delete-account`,
        request,
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          this.cacheService.invalidate(API_CACHE_KEYS.CURRENT_USER);
          this.cacheService.invalidate(API_CACHE_KEYS.AUTH_STATUS);
          this.cacheService.invalidate(API_CACHE_KEYS.LGPD_REQUESTS);
          this.cacheService.invalidate(API_CACHE_KEYS.ONBOARDING_STATUS);
        }),
      );
  }

  getPendingAccountDeletionRequests(): Observable<AdminDeleteAccountRequest[]> {
    return this.http.get<AdminDeleteAccountRequest[]>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests`,
      {
        withCredentials: true,
      },
    );
  }

  undoAccountDeletionRequest(
    id: string,
  ): Observable<AdminDeleteAccountRequest> {
    return this.http.post<AdminDeleteAccountRequest>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests/${id}/undo`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  deleteAccountNow(id: string): Observable<AdminDeleteAccountRequest> {
    return this.http.post<AdminDeleteAccountRequest>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests/${id}/delete-now`,
      {},
      {
        withCredentials: true,
      },
    );
  }
}
