import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatIconRegistry } from '@angular/material/icon';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { AppComponent } from './app.component';
import { AuthService } from './shared/services/auth/auth.service';
import { PrivacyDirectiveService } from './shared/services/privacy-directive.service';

describe('AppComponent', () => {
  beforeEach(async () => {
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
            isAuthenticated: signal(false),
          },
        },
        {
          provide: PrivacyDirectiveService,
          useValue: {
            directives: signal(null),
            shouldShowCookieBanner: signal(false),
            fetchDirectives: () =>
              of({
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
              }),
            acceptCookieBanner: () => of(true),
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
});
