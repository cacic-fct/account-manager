import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import type { TotpSeed, TotpStatus } from '@cacic/shared-types';
import { getApiBaseUrl } from '../../utils/api-url.util';

@Injectable({
  providedIn: 'root',
})
export class TotpApiService {
  private readonly baseUrl = getApiBaseUrl();
  private readonly http = inject(HttpClient);

  getStatus(): Observable<TotpStatus> {
    return this.http.get<TotpStatus>(`${this.baseUrl}/totp/status`, {
      withCredentials: true,
    });
  }

  getOrCreateSeed(): Observable<TotpSeed> {
    return this.http.post<TotpSeed>(
      `${this.baseUrl}/totp/seed`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  rotateSeed(): Observable<TotpSeed> {
    return this.http.post<TotpSeed>(
      `${this.baseUrl}/totp/seed/rotate`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  disableSeed(): Observable<TotpStatus> {
    return this.http.delete<TotpStatus>(`${this.baseUrl}/totp/seed`, {
      withCredentials: true,
    });
  }
}
