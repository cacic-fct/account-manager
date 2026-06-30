import {
  DestroyRef,
  Injectable,
  PLATFORM_ID,
  inject,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { firstValueFrom } from 'rxjs';
import { environment } from '../../../environments/environment';
import { PrivacyService } from './privacy.service';

interface SentryBrowserClient {
  getOptions(): { enabled?: boolean };
}

interface SentryBrowserApi {
  init(options: {
    dsn: string;
    environment: string;
    tracesSampleRate: number;
    beforeSend: (event: unknown) => unknown | null;
  }): void;
  captureException(error: Error, options?: { extra?: unknown }): void;
  getCurrentHub(): { getClient(): SentryBrowserClient | undefined };
}

declare global {
  interface Window {
    Sentry?: SentryBrowserApi;
  }
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private privacyService = inject(PrivacyService);
  private platformId = inject(PLATFORM_ID);
  private destroyRef = inject(DestroyRef);
  private initialized = false;
  private readonly isBrowser = isPlatformBrowser(this.platformId);
  private readonly sentryDsn = environment.sentryDsn;
  private readonly sentryEnvironment =
    environment.sentryEnvironment ??
    (environment.production ? 'production' : 'development');

  constructor() {
    if (!this.isBrowser) {
      return;
    }

    const handleCookieBannerAccepted = () => {
      void this.initializeAnalytics();
    };

    window.addEventListener('cookieBannerAccepted', handleCookieBannerAccepted);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener(
        'cookieBannerAccepted',
        handleCookieBannerAccepted,
      );
    });

    const stopPreferencesListener = this.privacyService.onPreferencesChange(
      (preferences) => {
        this.updateAnalyticsPreferences(preferences);
      },
    );
    this.destroyRef.onDestroy(stopPreferencesListener);
  }

  async initializeAnalytics(): Promise<void> {
    if (!this.isBrowser || this.initialized) {
      return;
    }

    await firstValueFrom(this.privacyService.loadSettings());
    const preferences = this.privacyService.getPreferencesForLibraries();

    if (preferences.errorDebugging) {
      this.initializeSentry();
    }

    this.initialized = true;
  }

  private initializeSentry(): void {
    const dsn = this.sentryDsn;
    if (!dsn || window.Sentry) {
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://browser.sentry-cdn.com/7.x.x/bundle.min.js';
    script.onload = () => {
      window.Sentry?.init({
        dsn,
        environment: this.sentryEnvironment,
        tracesSampleRate: 0.1,
        beforeSend: (event) =>
          this.privacyService.isErrorDebuggingEnabled() ? event : null,
      });
    };
    document.head.appendChild(script);
  }

  private updateAnalyticsPreferences(): void {
    if (!this.isBrowser) {
      return;
    }

    const sentryClient = window.Sentry?.getCurrentHub().getClient();
    if (sentryClient) {
      sentryClient.getOptions().enabled =
        this.privacyService.isErrorDebuggingEnabled();
    }
  }

  trackPageView(page: string): void {
    void page;
  }

  trackEvent(
    action: string,
    category: string,
    label?: string,
    value?: number,
  ): void {
    void action;
    void category;
    void label;
    void value;
  }

  trackError(error: Error, context?: unknown): void {
    if (!this.isBrowser || !this.privacyService.isErrorDebuggingEnabled()) {
      return;
    }

    if (window.Sentry) {
      window.Sentry.captureException(error, { extra: context });
      return;
    }

    console.error('Tracked error:', error, context);
  }
}
