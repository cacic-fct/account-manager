import { Service, inject, signal } from '@angular/core';
import { ApiService } from './api.service';
import { Observable } from 'rxjs';
import { tap, catchError, map } from 'rxjs/operators';
import { of } from 'rxjs';
import { LoggerService } from './logger.service';

@Service()
export class CookieBannerService {
  private apiService = inject(ApiService);
  private logger = inject(LoggerService);

  private _shouldShowBanner = signal(false);
  private _isLoading = signal(false);
  private _hasChecked = signal(false);

  // Public signals
  shouldShowBanner = this._shouldShowBanner.asReadonly();
  isLoading = this._isLoading.asReadonly();
  hasChecked = this._hasChecked.asReadonly();

  /**
   * Check if cookie banner should be displayed
   */
  checkBannerStatus(): Observable<boolean> {
    if (this._hasChecked() && !this._isLoading()) {
      return of(this._shouldShowBanner());
    }

    this._isLoading.set(true);

    return this.apiService.getCookieBannerStatus().pipe(
      tap((response) => {
        this._shouldShowBanner.set(response.shouldShow);
        this._hasChecked.set(true);
        this._isLoading.set(false);
      }),
      catchError((error) => {
        this.logger.error('Error checking cookie banner status', error, { operation: 'cookie-banner' });
        // On error, assume we should show the banner for safety
        this._shouldShowBanner.set(true);
        this._hasChecked.set(true);
        this._isLoading.set(false);
        return of(true);
      }),
      map(() => this._shouldShowBanner()),
    );
  }

  /**
   * Accept the cookie banner and hide it
   */
  acceptBanner(): Observable<boolean> {
    this._isLoading.set(true);

    return this.apiService.acceptCookieBanner().pipe(
      tap(() => {
        this._shouldShowBanner.set(false);
        this._isLoading.set(false);
        this.notifyAcceptance();
      }),
      map(() => true), // Always return true on success
      catchError((error) => {
        this.logger.error('Error accepting cookie banner', error, { operation: 'cookie-banner' });
        this._isLoading.set(false);
        return of(false);
      }),
    );
  }

  /**
   * Force hide banner (for guest users or temporary hiding)
   */
  hideBanner(): void {
    this._shouldShowBanner.set(false);
    // Store in localStorage for guest users
    localStorage.setItem('cookieBannerHidden', 'true');
  }

  /**
   * Check localStorage for guest users
   */
  checkLocalStorage(): boolean {
    return localStorage.getItem('cookieBannerHidden') === 'true';
  }

  /**
   * Reset banner status (for testing or logout)
   */
  resetBannerStatus(): void {
    this._shouldShowBanner.set(false);
    this._hasChecked.set(false);
    this._isLoading.set(false);
    localStorage.removeItem('cookieBannerHidden');
  }

  /**
   * Notify other parts of the application about banner acceptance
   */
  private notifyAcceptance(): void {
    // Dispatch custom event for analytics initialization
    window.dispatchEvent(
      new CustomEvent('cookieBannerAccepted', {
        detail: { timestamp: new Date() },
      }),
    );
  }
}
