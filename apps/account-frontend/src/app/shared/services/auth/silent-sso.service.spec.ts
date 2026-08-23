import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ApiService } from '../api.service';
import { SilentSsoService } from './silent-sso.service';

describe('SilentSsoService', () => {
  const apiService = {
    getSilentLoginUrl: vi.fn<(returnUrl?: string) => string>(),
  };

  beforeEach(() => {
    document.head.innerHTML = '<base href="/app/">';
    document.body.innerHTML = '';
    apiService.getSilentLoginUrl.mockReset();
    apiService.getSilentLoginUrl.mockImplementation(
      (returnUrl) => `http://localhost:3000/api/auth/login/redirect?prompt=none&returnTo=${returnUrl}`,
    );

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        SilentSsoService,
        { provide: ApiService, useValue: apiService },
        { provide: DOCUMENT, useValue: document },
        { provide: PLATFORM_ID, useValue: 'browser' },
      ],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('checks the existing SSO session in a hidden iframe', async () => {
    const service = TestBed.inject(SilentSsoService);
    const result = service.check();
    const iframe = requireIframe();
    const authorizationUrl = new URL(iframe.src);

    expect(iframe.hidden).toBe(true);
    expect(authorizationUrl.pathname).toBe('/api/auth/login/redirect');
    expect(authorizationUrl.searchParams.get('prompt')).toBe('none');
    expect(authorizationUrl.searchParams.get('returnTo')).toBe('/app/silent-check-sso.html');

    dispatchCompletionMessage(iframe, `${window.location.origin}/app/silent-check-sso.html`);

    await expect(result).resolves.toBe('authenticated');
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('treats a completed no-session check as unauthenticated', async () => {
    const service = TestBed.inject(SilentSsoService);
    const result = service.check();
    const iframe = requireIframe();

    dispatchCompletionMessage(iframe, `${window.location.origin}/app/silent-check-sso.html?sso=none`);

    await expect(result).resolves.toBe('unauthenticated');
  });

  it('rejects completion messages that do not come from the SSO iframe', async () => {
    vi.useFakeTimers();
    const service = TestBed.inject(SilentSsoService);
    const result = service.check();
    const iframe = requireIframe();

    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'cacic-silent-sso-complete',
          href: `${window.location.origin}/app/silent-check-sso.html`,
        },
        origin: window.location.origin,
        source: window,
      }),
    );
    const rejection = expect(result).rejects.toThrow('Silent SSO check timed out.');
    await vi.advanceTimersByTimeAsync(15_000);

    await rejection;
    expect(iframe.isConnected).toBe(false);
  });

  function requireIframe(): HTMLIFrameElement {
    const iframe = document.querySelector('iframe');
    expect(iframe).toBeInstanceOf(HTMLIFrameElement);
    return iframe as HTMLIFrameElement;
  }

  function dispatchCompletionMessage(iframe: HTMLIFrameElement, href: string): void {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'cacic-silent-sso-complete',
          href,
        },
        origin: window.location.origin,
        source: iframe.contentWindow,
      }),
    );
  }
});
