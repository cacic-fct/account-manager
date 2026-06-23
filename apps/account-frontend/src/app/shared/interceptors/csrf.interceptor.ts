import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CsrfService } from '../services/csrf.service';
import { switchMap, catchError } from 'rxjs/operators';

/**
 * HTTP Interceptor that automatically adds CSRF tokens to state-changing requests
 * Applies to POST, PUT, PATCH, and DELETE methods
 */
const isBrowser = () => isPlatformBrowser(inject(PLATFORM_ID));

export const csrfInterceptor: HttpInterceptorFn = (req, next) => {
  // Avoid CSRF logic in SSR (no cookie store available)
  if (!isBrowser()) {
    return next(req);
  }

  const csrfService = inject(CsrfService);

  // Only add CSRF token for state-changing methods
  const methodsRequiringCsrf = ['POST', 'PUT', 'PATCH', 'DELETE'];
  if (!methodsRequiringCsrf.includes(req.method.toUpperCase())) {
    return next(req);
  }

  // Skip CSRF token for external APIs or specific endpoints
  if (shouldSkipCsrf(req)) {
    return next(req);
  }

  // Try to get token from cookie first (double-submit pattern)
  const tokenFromCookie = csrfService.getTokenFromCookie();

  if (tokenFromCookie) {
    const clonedReq = req.clone({
      setHeaders: {
        'X-CSRF-TOKEN': tokenFromCookie,
      },
    });
    return next(clonedReq);
  }

  // If no token in cookie, fetch it and retry the request
  return csrfService.getToken().pipe(
    switchMap((token) => {
      const clonedReq = req.clone({
        setHeaders: {
          'X-CSRF-TOKEN': token,
        },
      });
      return next(clonedReq);
    }),
    catchError((error) => {
      console.error('Failed to add CSRF token to request:', error);
      // Continue with request even if CSRF fetch fails
      // The backend will reject it, but we don't want to block the request
      return next(req);
    }),
  );
};

/**
 * Determine if CSRF token should be skipped for a request
 */
function shouldSkipCsrf(req: HttpRequest<unknown>): boolean {
  if (!isBrowser()) {
    return true;
  }

  // Skip for external URLs (not same-origin)
  if (
    req.url.startsWith('http') &&
    !req.url.includes(window.location.hostname)
  ) {
    return true;
  }

  // Skip for specific endpoints if needed
  // Example: OAuth callbacks, public endpoints, etc.
  const skipPatterns = [
    '/auth/callback',
    '/auth/login',
    '/auth/logout',
    '/csrf/token',
  ];

  return skipPatterns.some((pattern) => req.url.includes(pattern));
}
