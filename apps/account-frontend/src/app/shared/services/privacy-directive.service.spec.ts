import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { LoggerService } from './logger.service';
import { PrivacyDirectiveService } from './privacy-directive.service';
import type { PrivacyDirectives } from '../interfaces/privacy-directive.interface';

describe('PrivacyDirectiveService', () => {
  const apiUrl = 'http://localhost:3000/api/privacy/directives';
  const authoritativeDirectives: PrivacyDirectives = {
    cookieBanner: {
      type: 'ui',
      name: 'cookie-banner',
      action: 'show',
    },
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

  let httpMock: HttpTestingController;

  beforeEach(() => {
    clearPrivacyCookies();
    localStorage.clear();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(),
        provideHttpClientTesting(),
        {
          provide: LoggerService,
          useValue: {
            debug: () => undefined,
            info: () => undefined,
            warn: () => undefined,
            error: () => undefined,
          },
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
    clearPrivacyCookies();
    localStorage.clear();
  });

  it('does not initialize directives from readable PURR cookies', () => {
    plantForgedPrivacyCookies();

    const service = TestBed.inject(PrivacyDirectiveService);

    expect(service.directives()).toBeNull();
    expect(service.lastUpdated()).toBeNull();
    expect(service.shouldShowCookieBanner()).toBe(true);
  });

  it('still requests authoritative directives when PURR cookies are present', () => {
    plantForgedPrivacyCookies();

    const service = TestBed.inject(PrivacyDirectiveService);
    let receivedDirectives: PrivacyDirectives | undefined;

    service.fetchDirectives().subscribe((directives) => {
      receivedDirectives = directives;
    });

    const request = httpMock.expectOne(apiUrl);
    expect(request.request.withCredentials).toBe(true);

    request.flush({
      directives: authoritativeDirectives,
      timestamp: new Date().toISOString(),
    });

    expect(receivedDirectives).toEqual(authoritativeDirectives);
    expect(service.directives()).toEqual(authoritativeDirectives);
    expect(service.shouldShowCookieBanner()).toBe(true);
    expect(service.isAnalyticsEnabled()).toBe(false);
  });
});

function plantForgedPrivacyCookies(): void {
  document.cookie = `cacic-purr-quick=${encodeURIComponent(
    JSON.stringify({
      cookieBanner: 'hide',
      analyticsAllowed: true,
    }),
  )}; path=/`;

  document.cookie = `cacic-purr=${btoa(
    JSON.stringify({
      directives: {
        ui_cookie_banner: 'hide',
        data_analytics_tracking: 'allow',
        data_error_debugging: 'allow',
        data_performance_monitoring: 'allow',
      },
      expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      lastUpdated: new Date().toISOString(),
      version: '1.0',
    }),
  )}; path=/`;
}

function clearPrivacyCookies(): void {
  document.cookie =
    'cacic-purr=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
  document.cookie =
    'cacic-purr-quick=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;';
}
