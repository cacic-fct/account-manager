import {
  provideZonelessChangeDetection,
  signal,
  type WritableSignal,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './shared/services/auth/auth.service';
import { PrivacyDirectiveService } from './shared/services/privacy-directive.service';
import type { PrivacyDirectives } from './shared/interfaces/privacy-directive.interface';

describe('AppComponent', () => {
  let isAuthenticated: WritableSignal<boolean>;
  let directives: PrivacyDirectives;
  let acceptCookieBannerCallCount: number;

  beforeEach(async () => {
    isAuthenticated = signal(false);
    directives = {
      cookieBanner: {
        type: 'ui',
        name: 'cookie-banner',
        action: 'hide',
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
    acceptCookieBannerCallCount = 0;
    document.cookie =
      'cacic_cookie_banner_accepted=; Max-Age=0; path=/; SameSite=Lax';

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        provideZonelessChangeDetection(),
        provideRouter([]),
        {
          provide: MatIconRegistry,
          useValue: {
            setDefaultFontSetClass: () => undefined,
          },
        },
        {
          provide: AuthService,
          useValue: {
            isAuthenticated,
          },
        },
        {
          provide: PrivacyDirectiveService,
          useValue: {
            directives: signal(null),
            shouldShowCookieBanner: signal(false),
            fetchDirectives: () => of(directives),
            acceptCookieBanner: () => {
              acceptCookieBannerCallCount++;
              return of(true);
            },
          },
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });

  it(`should have the 'cacic-account-manager' title`, () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app.title).toEqual('cacic-account-manager');
  });

  it('should render the app shell', () => {
    const fixture = TestBed.createComponent(AppComponent);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.querySelector('router-outlet')).toBeTruthy();
  });

  it('syncs a logged-out banner acceptance after login', () => {
    isAuthenticated.set(true);
    directives = {
      ...directives,
      cookieBanner: {
        type: 'ui',
        name: 'cookie-banner',
        action: 'show',
      },
    };
    document.cookie =
      'cacic_cookie_banner_accepted=true; Max-Age=31536000; path=/; SameSite=Lax';

    TestBed.createComponent(AppComponent);

    expect(acceptCookieBannerCallCount).toBe(1);
  });

  it('does not sync banner acceptance when the account already accepted it', () => {
    isAuthenticated.set(true);
    document.cookie =
      'cacic_cookie_banner_accepted=true; Max-Age=31536000; path=/; SameSite=Lax';

    TestBed.createComponent(AppComponent);

    expect(acceptCookieBannerCallCount).toBe(0);
  });
});
