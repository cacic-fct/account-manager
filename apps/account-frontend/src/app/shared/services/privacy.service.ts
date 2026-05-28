import { Injectable, inject, signal, computed } from '@angular/core';
import { ApiService } from './api.service';
import type { PrivacySetting } from '@cacic/shared-types';
import { BehaviorSubject, Observable, of } from 'rxjs';
import { tap, catchError, shareReplay } from 'rxjs/operators';
import { AuthService } from './auth/auth.service';
import { LoggerService } from './logger.service';

export interface PrivacyPreferences {
  analyticsTracking: boolean;
  errorDebugging: boolean;
  performanceMonitoring: boolean;
  cookieBannerAccepted: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class PrivacyService {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);

  private _settings = signal<PrivacySetting | null>(null);
  private _isLoading = signal(false);
  private _lastUpdated = signal<Date | null>(null);

  // Public signals
  settings = this._settings.asReadonly();
  isLoading = this._isLoading.asReadonly();
  lastUpdated = this._lastUpdated.asReadonly();

  // Computed preferences for easy access
  preferences = computed<PrivacyPreferences>(() => {
    const settings = this._settings();

    if (!settings) {
      return {
        analyticsTracking: false,
        errorDebugging: false,
        performanceMonitoring: false,
        cookieBannerAccepted: false,
      };
    }

    return {
      analyticsTracking: settings.settings.analytics_tracking,
      errorDebugging: settings.settings.error_debugging,
      performanceMonitoring: settings.settings.performance_monitoring,
      cookieBannerAccepted: settings.settings.cookie_banner_accepted,
    };
  });

  // Individual preference signals for reactive components
  analyticsEnabled = computed(() => this.preferences().analyticsTracking);
  errorDebuggingEnabled = computed(() => this.preferences().errorDebugging);
  performanceEnabled = computed(() => this.preferences().performanceMonitoring);
  cookieAccepted = computed(() => this.preferences().cookieBannerAccepted);

  /**
   * Load privacy settings for the current user
   */
  loadSettings(): Observable<PrivacySetting | null> {
    if (!this.authService.isAuthenticated()) {
      return of(null);
    }

    this._isLoading.set(true);

    return this.apiService.getPrivacySettings().pipe(
      tap((settings) => {
        this._settings.set(settings);
        this._lastUpdated.set(new Date());
        this._isLoading.set(false);
      }),
      catchError((error) => {
        this.logger.error('Error loading privacy settings', error);
        this._isLoading.set(false);
        return of(null);
      }),
      shareReplay(1),
    );
  }

  /**
   * Initialize privacy settings for a new user
   */
  initializeSettings(): Observable<PrivacySetting | null> {
    if (!this.authService.isAuthenticated()) {
      return of(null);
    }

    return this.apiService.initializePrivacySettings().pipe(
      tap((settings) => {
        this._settings.set(settings);
        this._lastUpdated.set(new Date());
      }),
      catchError((error) => {
        this.logger.error('Error initializing privacy settings', error);
        return of(null);
      }),
    );
  }

  /**
   * Check if analytics should be enabled
   */
  isAnalyticsEnabled(): boolean {
    return this.analyticsEnabled();
  }

  /**
   * Check if error debugging should be enabled
   */
  isErrorDebuggingEnabled(): boolean {
    return this.errorDebuggingEnabled();
  }

  /**
   * Check if performance monitoring should be enabled
   */
  isPerformanceEnabled(): boolean {
    return this.performanceEnabled();
  }

  /**
   * Get privacy preferences for external libraries
   */
  getPreferencesForLibraries(): {
    analytics: boolean;
    performance: boolean;
    errorDebugging: boolean;
  } {
    const prefs = this.preferences();
    return {
      analytics: prefs.analyticsTracking,
      performance: prefs.performanceMonitoring,
      errorDebugging: prefs.errorDebugging,
    };
  }

  /**
   * Listen for privacy preference changes
   */
  onPreferencesChange(
    callback: (preferences: PrivacyPreferences) => void,
  ): void {
    // Use effect to watch for changes
    let lastPrefs = this.preferences();

    const checkForChanges = () => {
      const currentPrefs = this.preferences();
      if (JSON.stringify(currentPrefs) !== JSON.stringify(lastPrefs)) {
        lastPrefs = currentPrefs;
        callback(currentPrefs);
      }
      requestAnimationFrame(checkForChanges);
    };

    checkForChanges();
  }

  /**
   * Refresh settings from server
   */
  refreshSettings(): Observable<PrivacySetting | null> {
    return this.loadSettings();
  }

  /**
   * Update a single privacy setting
   */
  updateSetting(key: string, enabled: boolean): Observable<PrivacySetting> {
    if (!this.authService.isAuthenticated()) {
      return of().pipe(
        tap(() => {
          throw new Error('Not authenticated');
        }),
      );
    }

    const updateData = { enabled };

    return this.apiService.updatePrivacySetting(key, updateData).pipe(
      tap((updatedSettings) => {
        // Update local cache with the complete updated settings object
        this._settings.set(updatedSettings);
        this._lastUpdated.set(new Date());
      }),
    );
  }

  /**
   * Bulk update multiple privacy settings
   */
  bulkUpdateSettings(
    updates: Array<{ key: string; enabled: boolean }>,
  ): Observable<PrivacySetting> {
    if (!this.authService.isAuthenticated()) {
      return of().pipe(
        tap(() => {
          throw new Error('Not authenticated');
        }),
      );
    }

    const bulkData = updates.reduce((acc, update) => {
      acc[update.key] = { enabled: update.enabled };
      return acc;
    }, {} as any);

    return this.apiService.bulkUpdatePrivacySettings(bulkData).pipe(
      tap((settings) => {
        this._settings.set(settings);
        this._lastUpdated.set(new Date());
      }),
    );
  }

  /**
   * Clear cached settings (on logout)
   */
  clearSettings(): void {
    this._settings.set(null);
    this._lastUpdated.set(null);
    this._isLoading.set(false);
  }

  /**
   * Update local settings cache after API calls
   */
  updateSettingsCache(settings: PrivacySetting): void {
    this._settings.set(settings);
    this._lastUpdated.set(new Date());
  }
}
