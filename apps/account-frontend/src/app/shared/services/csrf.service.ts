import { Service, inject, PLATFORM_ID } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { isPlatformBrowser } from '@angular/common';
import { Observable, BehaviorSubject, of } from 'rxjs';
import { tap, catchError, shareReplay, map } from 'rxjs/operators';
import { getApiBaseUrl } from '../utils/api-url.util';

/**
 * Service for managing CSRF tokens
 * Implements automatic token fetching and storage
 */
@Service()
export class CsrfService {
  private http = inject(HttpClient);
  private readonly baseUrl = getApiBaseUrl();

  // Store CSRF token in memory
  private csrfToken$ = new BehaviorSubject<string | null>(null);

  /**
   * Get the current CSRF token, fetching it if not available
   */
  getToken(): Observable<string> {
    const currentToken = this.csrfToken$.value;

    if (currentToken) {
      return of(currentToken);
    }

    return this.fetchToken();
  }

  /**
   * Fetch a new CSRF token from the server
   */
  fetchToken(): Observable<string> {
    return this.http
      .get<{ csrfToken: string }>(`${this.baseUrl}/csrf/token`, {
        withCredentials: true,
      })
      .pipe(
        tap((response) => {
          this.csrfToken$.next(response.csrfToken);
        }),
        map((response: { csrfToken: string }) => response.csrfToken),
        shareReplay({ bufferSize: 1, refCount: true }),
        catchError((error) => {
          console.error('Failed to fetch CSRF token:', error);
          throw error;
        }),
      );
  }

  /**
   * Get the current token value synchronously (may be null)
   */
  getTokenSync(): string | null {
    return this.csrfToken$.value;
  }

  /**
   * Clear the stored token (useful on logout)
   */
  clearToken(): void {
    this.csrfToken$.next(null);
  }

  /**
   * Get the token from cookie (alternative method)
   */
  getTokenFromCookie(): string | null {
    if (!isPlatformBrowser(inject(PLATFORM_ID))) {
      return null;
    }

    const name = 'XSRF-TOKEN=';
    const decodedCookie = decodeURIComponent(document.cookie);
    const cookieArray = decodedCookie.split(';');

    for (let cookie of cookieArray) {
      cookie = cookie.trim();
      if (cookie.indexOf(name) === 0) {
        return cookie.substring(name.length);
      }
    }
    return null;
  }
}
