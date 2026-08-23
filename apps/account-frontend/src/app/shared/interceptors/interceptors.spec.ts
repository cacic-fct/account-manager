import { HttpRequest } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { of, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { CsrfService } from '../services/csrf.service';
import { LoggerService } from '../services/logger.service';
import { credentialsInterceptor } from './credentials.interceptor';
import { csrfInterceptor } from './csrf.interceptor';

describe('frontend request interceptors', () => {
  const apiUrl = `${environment.apiUrl}/resource`;
  let csrfService: { getTokenFromCookie: ReturnType<typeof vi.fn>; getToken: ReturnType<typeof vi.fn> };
  let logger: { error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    csrfService = {
      getTokenFromCookie: vi.fn().mockReturnValue(null),
      getToken: vi.fn().mockReturnValue(of('csrf-token')),
    };
    logger = { error: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: CsrfService, useValue: csrfService },
        { provide: LoggerService, useValue: logger },
      ],
    });
  });

  afterEach(() => TestBed.resetTestingModule());

  it('does not replay a protected mutation when the application request fails', () => {
    const next = vi.fn().mockReturnValue(throwError(() => new Error('network failure')));
    const request = new HttpRequest('POST', apiUrl, { value: 'mutation' });
    let receivedError: unknown;

    TestBed.runInInjectionContext(() => {
      csrfInterceptor(request, next).subscribe({ error: (error) => (receivedError = error) });
    });

    expect(receivedError).toBeInstanceOf(Error);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0].headers.get('X-CSRF-TOKEN')).toBe('csrf-token');
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('fails closed when token acquisition fails', () => {
    csrfService.getToken.mockReturnValue(throwError(() => new Error('token unavailable')));
    const next = vi.fn();
    const request = new HttpRequest('POST', apiUrl, { value: 'mutation' });

    TestBed.runInInjectionContext(() => {
      csrfInterceptor(request, next).subscribe({ error: () => undefined });
    });

    expect(next).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledOnce();
  });

  it('does not classify lookalike external URLs as API requests', () => {
    const next = vi.fn().mockReturnValue(of('ok'));
    const request = new HttpRequest('POST', 'https://api.example.com.attacker.test/api/auth/logout', {});

    TestBed.runInInjectionContext(() => {
      csrfInterceptor(request, next).subscribe();
    });

    expect(next).toHaveBeenCalledOnce();
    expect(csrfService.getToken).not.toHaveBeenCalled();
  });

  it('matches exact skip routes, not sibling paths or query strings', () => {
    const next = vi.fn().mockImplementation((request: HttpRequest<unknown>) => of(request));

    const exactLogout = new HttpRequest('POST', `${environment.apiUrl}/auth/logout`, {});
    const sibling = new HttpRequest('POST', `${environment.apiUrl}/auth/logout-audit`, {});
    const queryOnly = new HttpRequest('POST', `${environment.apiUrl}/auth/me?next=/auth/logout`, {});

    TestBed.runInInjectionContext(() => {
      csrfInterceptor(exactLogout, next).subscribe();
      csrfInterceptor(sibling, next).subscribe();
      csrfInterceptor(queryOnly, next).subscribe();
    });

    expect(next.mock.calls[0][0].headers.has('X-CSRF-TOKEN')).toBe(false);
    expect(next.mock.calls[1][0].headers.get('X-CSRF-TOKEN')).toBe('csrf-token');
    expect(next.mock.calls[2][0].headers.get('X-CSRF-TOKEN')).toBe('csrf-token');
  });

  it('adds credentials without forcing content type on non-JSON or bodyless requests', () => {
    const requests: HttpRequest<unknown>[] = [];
    const next = vi.fn().mockImplementation((request: HttpRequest<unknown>) => {
      requests.push(request);
      return of(request);
    });

    credentialsInterceptor(new HttpRequest('DELETE', apiUrl), next).subscribe();
    credentialsInterceptor(new HttpRequest('POST', apiUrl, 'plain text'), next).subscribe();
    credentialsInterceptor(new HttpRequest('POST', apiUrl, new Blob(['binary'])), next).subscribe();
    credentialsInterceptor(new HttpRequest('POST', apiUrl, new URLSearchParams('a=b')), next).subscribe();
    credentialsInterceptor(new HttpRequest('POST', apiUrl, { value: 'json' }), next).subscribe();

    expect(requests[0].withCredentials).toBe(true);
    expect(requests[0].headers.has('Content-Type')).toBe(false);
    expect(requests[1].headers.has('Content-Type')).toBe(false);
    expect(requests[2].headers.has('Content-Type')).toBe(false);
    expect(requests[3].headers.has('Content-Type')).toBe(false);
    expect(requests[4].headers.get('Content-Type')).toBe('application/json');
  });
});
