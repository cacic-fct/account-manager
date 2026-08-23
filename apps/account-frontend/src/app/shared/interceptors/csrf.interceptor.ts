import { HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, PLATFORM_ID } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { CsrfService } from '../services/csrf.service';
import { LoggerService } from '../services/logger.service';
import { catchError, switchMap } from 'rxjs/operators';
import { isConfiguredApiRequest, isConfiguredApiRoute } from '../utils/request-url.util';
import { throwError } from 'rxjs';

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
  const logger = inject(LoggerService);

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
  // Catch only token acquisition failures. Once a protected request has been
  // sent, its errors must propagate without replaying the mutation unprotected.
  return csrfService.getToken().pipe(
    catchError((error: unknown) => {
      logger.error('Failed to acquire CSRF token', error);
      return throwError(() => error);
    }),
    switchMap((token) => {
      const clonedReq = req.clone({
        setHeaders: {
          'X-CSRF-TOKEN': token,
        },
      });
      return next(clonedReq);
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

  // Only the configured API receives CSRF handling. This keeps third-party
  // requests out of the interceptor while still supporting the development API
  // origin, which is intentionally different from the frontend origin.
  if (!isConfiguredApiRequest(req.url)) {
    return true;
  }

  // Skip only exact API routes. Query strings and sibling paths must not change
  // endpoint classification.
  const skipRoutes = ['/auth/callback', '/auth/login', '/auth/logout', '/csrf/token'];

  return skipRoutes.some((route) => isConfiguredApiRoute(req.url, route));
}
