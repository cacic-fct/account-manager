import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { PrivacyDirectives, PrivacyDirectiveResponse } from '../interfaces/privacy-directive.interface';
import { getApiBaseUrl } from '../utils/api-url.util';
import { LoggerService } from './logger.service';

@Injectable({
  providedIn: 'root',
})
export class PrivacyDirectiveService {
  private http = inject(HttpClient);
  private baseUrl = getApiBaseUrl();
  private logger = inject(LoggerService);

  // Directive signals
  private _directives = signal<PrivacyDirectives | null>(null);
  private _isLoading = signal(false);
  private _lastUpdated = signal<Date | null>(null);

  // Public readonly signals
  directives = this._directives.asReadonly();
  isLoading = this._isLoading.asReadonly();
  lastUpdated = this._lastUpdated.asReadonly();

  // Cookie banner specific signals
  private _shouldShowCookieBanner = signal(true); // Default to showing banner
  shouldShowCookieBanner = this._shouldShowCookieBanner.asReadonly();
  isAcceptingCookies = signal(false);

  constructor() {
    // Fallback to localStorage for guest users and offline access. Server
    // directives still refresh on startup because localStorage is not marked
    // as a fresh authoritative cache.
    if (!this._directives()) {
      this.loadFromLocalStorage();
    }
  }

  /**
   * Fetch privacy directives from backend (PURR-style - only when needed)
   */
  fetchDirectives(forceRefresh = false): Observable<PrivacyDirectives> {
    const cachedDirectives = this._directives();

    // If we already have valid directives and not forcing refresh, return cached
    if (!forceRefresh && cachedDirectives && this.hasValidCachedDirectives()) {
      return of(cachedDirectives);
    }

    this._isLoading.set(true);

    return this.http
      .get<PrivacyDirectiveResponse>(`${this.baseUrl}/privacy/directives`, {
        withCredentials: true,
        observe: 'response', // We need to read headers
      })
      .pipe(
        tap((response) => {
          // Check if directives are in response headers (PURR-style)
          const directivesHeader = response.headers.get('X-Privacy-Directives');
          this.logger.debug('Loaded directives from response headers');
          const directives = this.parseDirectiveResponse(directivesHeader, response.body);

          this._directives.set(directives);
          this._lastUpdated.set(new Date());
          this._isLoading.set(false);
          this.logger.debug('Privacy directives fetched successfully');

          // Update cookie banner visibility based on directives
          this._shouldShowCookieBanner.set(directives.cookieBanner.action === 'show');

          // Store in localStorage for offline access
          this.saveToLocalStorage(directives);
        }),
        map((response) => {
          const directivesHeader = response.headers.get('X-Privacy-Directives');
          this.logger.debug('Loaded directives from response headers');
          return this.parseDirectiveResponse(directivesHeader, response.body);
        }),
        catchError((error) => {
          this.logger.error('Error fetching privacy directives', error);
          this._isLoading.set(false);

          // Try to load from localStorage as fallback
          const cached = this.loadFromLocalStorage();
          if (cached) {
            // Update cookie banner visibility for cached directives too
            this._shouldShowCookieBanner.set(cached.cookieBanner.action === 'show');
            return of(cached);
          }

          // Default fallback - show cookie banner
          const defaultDirectives: PrivacyDirectives = {
            cookieBanner: { type: 'ui', name: 'cookie-banner', action: 'show' },
            analyticsTracking: {
              type: 'data-handling',
              name: 'analytics-tracking',
              action: 'disable',
            },
            errorDebugging: {
              type: 'data-handling',
              name: 'error-debugging',
              action: 'disable',
            },
            performanceMonitoring: {
              type: 'data-handling',
              name: 'performance-monitoring',
              action: 'disable',
            },
          };

          this._directives.set(defaultDirectives);
          this._shouldShowCookieBanner.set(true); // Explicitly show for defaults
          return of(defaultDirectives);
        }),
      );
  }

  /**
   * Accept cookie banner and update backend
   */
  acceptCookieBanner(): Observable<boolean> {
    this.isAcceptingCookies.set(true);

    return this.http
      .post<unknown>(
        `${this.baseUrl}/privacy/cookie-banner/accept`,
        {},
        {
          withCredentials: true,
          observe: 'response', // We need to read updated headers
          responseType: 'json', // Explicitly set response type
        },
      )
      .pipe(
        tap((response) => {
          // Check for updated directives in response headers
          const directivesHeader = response.headers.get('X-Privacy-Directives');
          if (directivesHeader) {
            try {
              const updatedDirectives = JSON.parse(directivesHeader);
              this._directives.set(updatedDirectives);
              this.saveToLocalStorage(updatedDirectives);
            } catch {
              this.logger.warn('Failed to parse updated directives from headers');
            }
          }

          // Hide cookie banner immediately
          this._shouldShowCookieBanner.set(false);
          this.isAcceptingCookies.set(false);
          this._lastUpdated.set(new Date());
          this.logger.debug('Cookie banner accepted');

          // Notify other components
          this.refreshTrackingCookies();
          this.notifyAcceptance();
        }),
        map(() => true),
        catchError((error) => {
          this.logger.error('Error accepting cookie banner', error);
          this.isAcceptingCookies.set(false);
          return of(false);
        }),
      );
  }

  /**
   * Force hide cookie banner (for guest users)
   */
  hideCookieBanner(): void {
    this._shouldShowCookieBanner.set(false);

    // Update directives to reflect the change
    const currentDirectives = this._directives();
    if (currentDirectives) {
      const updatedDirectives = {
        ...currentDirectives,
        cookieBanner: {
          ...currentDirectives.cookieBanner,
          action: 'hide' as const,
        },
      };
      this._directives.set(updatedDirectives);
      this.saveToLocalStorage(updatedDirectives);
    }

    // Store in localStorage for guest users
    localStorage.setItem('cookieBannerHidden', 'true');
  }

  private parseDirectiveResponse(
    directivesHeader: string | null,
    body: PrivacyDirectiveResponse | null,
  ): PrivacyDirectives {
    if (directivesHeader) {
      try {
        return JSON.parse(directivesHeader) as PrivacyDirectives;
      } catch {
        this.logger.warn('Failed to parse directives from headers');
      }
    }

    if (body?.directives) {
      return body.directives;
    }

    throw new Error('Privacy directives response missing directives');
  }

  /**
   * Check if we have valid cached directives (PURR-style efficiency)
   */
  private hasValidCachedDirectives(): boolean {
    const directives = this._directives();
    const lastUpdated = this._lastUpdated();

    if (!directives || !lastUpdated) {
      return false;
    }

    // Check if cache is less than 1 hour old
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    return lastUpdated > oneHourAgo;
  }

  /**
   * Check if analytics tracking is enabled based on directives
   */
  isAnalyticsEnabled(): boolean {
    const directives = this._directives();
    return directives?.analyticsTracking.action === 'enable';
  }

  /**
   * Check if error debugging is enabled based on directives
   */
  isErrorDebuggingEnabled(): boolean {
    const directives = this._directives();
    return directives?.errorDebugging.action === 'enable';
  }

  /**
   * Check if performance monitoring is enabled based on directives
   */
  isPerformanceMonitoringEnabled(): boolean {
    const directives = this._directives();
    return directives?.performanceMonitoring.action === 'enable';
  }

  /**
   * Save directives to localStorage
   */
  private saveToLocalStorage(directives: PrivacyDirectives): void {
    try {
      localStorage.setItem(
        'privacyDirectives',
        JSON.stringify({
          directives,
          timestamp: new Date().toISOString(),
        }),
      );
    } catch {
      this.logger.warn('Failed to save directives to localStorage');
    }
  }

  /**
   * Load directives from localStorage
   */
  private loadFromLocalStorage(): PrivacyDirectives | null {
    try {
      const stored = localStorage.getItem('privacyDirectives');
      if (stored) {
        const parsed = JSON.parse(stored);

        // Check if data is not too old (24 hours)
        const timestamp = new Date(parsed.timestamp);
        const now = new Date();
        const hoursDiff = (now.getTime() - timestamp.getTime()) / (1000 * 60 * 60);

        if (hoursDiff < 24) {
          this._directives.set(parsed.directives);

          // Update cookie banner visibility based on loaded directives
          this._shouldShowCookieBanner.set(parsed.directives.cookieBanner.action === 'show');

          return parsed.directives;
        }
      }
    } catch {
      this.logger.warn('Failed to load directives from localStorage');
    }

    // Check legacy cookie banner localStorage
    const cookieBannerHidden = localStorage.getItem('cookieBannerHidden') === 'true';
    if (cookieBannerHidden) {
      this._shouldShowCookieBanner.set(false);
    }

    return null;
  }

  /**
   * Refresh directives after privacy settings update
   */
  refreshAfterUpdate(): void {
    // Clear cache to force refresh
    this._directives.set(null);
    this._lastUpdated.set(null);

    // Fetch fresh directives
    this.fetchDirectives(true).subscribe({
      error: (error) => {
        this.logger.error('Failed to refresh privacy directives', error);
      },
    });
  }

  /**
   * Reset all privacy state (for logout)
   */
  reset(): void {
    this._directives.set(null);
    this._lastUpdated.set(null);
    this._shouldShowCookieBanner.set(true);
    this.isAcceptingCookies.set(false);
    localStorage.removeItem('privacyDirectives');
    localStorage.removeItem('cookieBannerHidden');

    // Clear shared privacy and tracking cookies.
    for (const cookieName of ['cacic-analytics-id', 'cacic-analytics-consent', 'cacic-purr', 'cacic-purr-quick']) {
      this.expireCookie(cookieName);
      this.expireCookie(cookieName, '.cacic.com.br');
    }
  }

  private refreshTrackingCookies(): void {
    this.http
      .get(`${this.baseUrl}/tracking/session`, {
        withCredentials: true,
      })
      .subscribe({
        next: () => window.dispatchEvent(new CustomEvent('cacicTrackingConsentChanged')),
        error: () => undefined,
      });
  }

  private expireCookie(name: string, domain?: string): void {
    const domainPart = domain ? `; domain=${domain}` : '';
    document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/${domainPart}; SameSite=Lax`;
  }

  /**
   * Notify other parts of the application about cookie acceptance
   */
  private notifyAcceptance(): void {
    window.dispatchEvent(
      new CustomEvent('cookieBannerAccepted', {
        detail: {
          timestamp: new Date(),
          directives: this._directives(),
        },
      }),
    );
  }
}
