import { Injectable, inject } from '@angular/core';
import { PrivacyService } from './privacy.service';

declare global {
  interface Window {
    gtag?: (...args: any[]) => void;
    dataLayer?: any[];
    Sentry?: any;
  }
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  private privacyService = inject(PrivacyService);
  private initialized = false;

  constructor() {
    // Listen for cookie banner acceptance
    window.addEventListener('cookieBannerAccepted', () => {
      this.initializeAnalytics();
    });

    // Check initial preferences
    this.privacyService.onPreferencesChange((preferences) => {
      this.updateAnalyticsPreferences(preferences);
    });
  }

  /**
   * Initialize analytics services based on privacy preferences
   */
  async initializeAnalytics(): Promise<void> {
    if (this.initialized) {
      return;
    }

    // Load privacy settings first
    await this.privacyService.loadSettings().toPromise();
    const preferences = this.privacyService.getPreferencesForLibraries();

    // Initialize Google Analytics if enabled
    if (preferences.analytics) {
      this.initializeGoogleAnalytics();
    }

    // Initialize Sentry if enabled
    if (preferences.errorDebugging) {
      this.initializeSentry();
    }

    // Initialize performance monitoring if enabled
    if (preferences.performance) {
      this.initializePerformanceMonitoring();
    }

    this.initialized = true;
    console.log('Analytics initialized with preferences:', preferences);
  }

  /**
   * Initialize Google Analytics
   */
  private initializeGoogleAnalytics(): void {
    const GA_MEASUREMENT_ID = 'G-XXXXXXXXXX'; // Replace with your GA4 Measurement ID

    // Create script tag for Google Analytics
    const script = document.createElement('script');
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
    document.head.appendChild(script);

    // Initialize dataLayer
    window.dataLayer = window.dataLayer || [];
    window.gtag = (...args: unknown[]) => {
      window.dataLayer!.push(args);
    };

    window.gtag('js', new Date());
    window.gtag('config', GA_MEASUREMENT_ID, {
      anonymize_ip: true,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
    });

    console.log('Google Analytics initialized');
  }

  /**
   * Initialize Sentry for error reporting
   */
  private initializeSentry(): void {
    // Note: In a real implementation, you would import Sentry properly
    // This is a simplified example showing the concept

    const SENTRY_DSN = 'YOUR_SENTRY_DSN'; // Replace with your Sentry DSN

    // Load Sentry script
    const script = document.createElement('script');
    script.src = 'https://browser.sentry-cdn.com/7.x.x/bundle.min.js';
    script.onload = () => {
      if (window.Sentry) {
        window.Sentry.init({
          dsn: SENTRY_DSN,
          environment: 'production',
          tracesSampleRate: 0.1,
          beforeSend(event: any) {
            // Only send if error reporting is still enabled
            return this.privacyService.isErrorDebuggingEnabled() ? event : null;
          },
        });
        console.log('Sentry initialized');
      }
    };
    document.head.appendChild(script);
  }

  /**
   * Initialize performance monitoring
   */
  private initializePerformanceMonitoring(): void {
    // Example: Web Vitals monitoring
    if ('PerformanceObserver' in window) {
      // Monitor Core Web Vitals
      this.observeWebVitals();
    }

    console.log('Performance monitoring initialized');
  }

  /**
   * Monitor Core Web Vitals
   */
  private observeWebVitals(): void {
    // Observe Largest Contentful Paint
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'largest-contentful-paint') {
          this.trackMetric('LCP', entry.startTime);
        }
      }
    }).observe({ entryTypes: ['largest-contentful-paint'] });

    // Observe First Input Delay
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.entryType === 'first-input') {
          this.trackMetric(
            'FID',
            (entry as any).processingStart - entry.startTime,
          );
        }
      }
    }).observe({ entryTypes: ['first-input'] });

    // Observe Cumulative Layout Shift
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (
          entry.entryType === 'layout-shift' &&
          !(entry as any).hadRecentInput
        ) {
          this.trackMetric('CLS', (entry as any).value);
        }
      }
    }).observe({ entryTypes: ['layout-shift'] });
  }

  /**
   * Track a metric if analytics is enabled
   */
  private trackMetric(name: string, value: number): void {
    if (this.privacyService.isPerformanceEnabled() && window.gtag) {
      window.gtag('event', name, {
        value: Math.round(value),
        custom_parameter: 'web_vitals',
      });
    }
  }

  /**
   * Update analytics preferences when user changes settings
   */
  private updateAnalyticsPreferences(preferences: any): void {
    // Disable Google Analytics if analytics tracking is disabled
    if (!preferences.analytics && window.gtag) {
      window.gtag('config', 'GA_MEASUREMENT_ID', {
        send_page_view: false,
      });
    }

    // Enable/disable Sentry
    if (!preferences.errorDebugging && window.Sentry) {
      const client = window.Sentry.getCurrentHub().getClient();
      if (client) {
        client.getOptions().enabled = false;
      }
    } else if (preferences.errorDebugging && window.Sentry) {
      const client = window.Sentry.getCurrentHub().getClient();
      if (client) {
        client.getOptions().enabled = true;
      }
    }

    console.log('Analytics preferences updated:', preferences);
  }

  /**
   * Track page view (only if analytics enabled)
   */
  trackPageView(page: string): void {
    if (this.privacyService.isAnalyticsEnabled() && window.gtag) {
      window.gtag('config', 'GA_MEASUREMENT_ID', {
        page_path: page,
      });
    }
  }

  /**
   * Track custom event (only if analytics enabled)
   */
  trackEvent(
    action: string,
    category: string,
    label?: string,
    value?: number,
  ): void {
    if (this.privacyService.isAnalyticsEnabled() && window.gtag) {
      window.gtag('event', action, {
        event_category: category,
        event_label: label,
        value: value,
      });
    }
  }

  /**
   * Track error (only if error debugging enabled)
   */
  trackError(error: Error, context?: any): void {
    if (this.privacyService.isErrorDebuggingEnabled()) {
      if (window.Sentry) {
        window.Sentry.captureException(error, { extra: context });
      } else {
        // Fallback: log to console or send to custom endpoint
        console.error('Tracked error:', error, context);
      }
    }
  }
}
