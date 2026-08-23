import { environment } from '../../../environments/environment';

const FALLBACK_ORIGIN = 'http://localhost';

function getApplicationOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }

  return FALLBACK_ORIGIN;
}

export function resolveRequestUrl(value: string): URL {
  return new URL(value, getApplicationOrigin());
}

function normalizePath(pathname: string): string {
  const normalized = pathname.replace(/\/+/g, '/').replace(/\/+$/, '');
  return normalized || '/';
}

function isPathWithinBase(pathname: string, basePath: string): boolean {
  const normalizedPath = normalizePath(pathname);
  const normalizedBase = normalizePath(basePath);

  return normalizedPath === normalizedBase || normalizedPath.startsWith(`${normalizedBase}/`);
}

/**
 * Returns true only when a request targets the configured API origin and path.
 * This intentionally rejects lookalike hosts and sibling paths such as `/api-v2`.
 */
export function isConfiguredApiRequest(requestUrl: string): boolean {
  const request = resolveRequestUrl(requestUrl);
  const api = resolveRequestUrl(environment.apiUrl);

  return request.origin === api.origin && isPathWithinBase(request.pathname, api.pathname);
}

export function isSameOriginRequest(requestUrl: string): boolean {
  return resolveRequestUrl(requestUrl).origin === getApplicationOrigin();
}

/**
 * Match an API route without treating query strings or similarly named routes as
 * the same endpoint (for example, `/auth/logout-audit` is not `/auth/logout`).
 */
export function isConfiguredApiRoute(requestUrl: string, routePath: string): boolean {
  const request = resolveRequestUrl(requestUrl);
  const api = resolveRequestUrl(environment.apiUrl);

  if (request.origin !== api.origin || !isPathWithinBase(request.pathname, api.pathname)) {
    return false;
  }

  const apiRelativePath = normalizePath(request.pathname).slice(normalizePath(api.pathname).length) || '/';
  const normalizedRoute = normalizePath(routePath);

  return apiRelativePath === normalizedRoute;
}
