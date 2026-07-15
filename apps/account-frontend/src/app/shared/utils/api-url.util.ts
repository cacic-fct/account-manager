import { environment } from '../../../environments/environment';

/**
 * Get the base API URL for HTTP requests.
 *
 * In development:
 * - Returns '/api' to use the proxy configuration
 * - Proxy rewrites /api/* to http://localhost:3000/*
 * - This avoids CORS issues during development
 *
 * In production:
 * - Returns the full API URL from environment config
 * - e.g., 'https://account.cacic.com.br/api'
 *
 * @returns The base URL for API requests
 */
export function getApiBaseUrl(): string {
  if (environment.production) {
    return environment.apiUrl;
  }

  return environment.apiUrl;
}

/**
 * Get the full API URL for a specific endpoint.
 * Automatically handles development proxy and production full URLs.
 *
 * @param endpoint - The API endpoint path (with or without leading slash)
 * @returns The full URL for the endpoint
 *
 * @example
 * ```typescript
 * getApiUrl('/privacy/directives') // Dev: '/api/privacy/directives', Prod: 'https://account.cacic.com.br/api/privacy/directives'
 * getApiUrl('privacy/directives')  // Same result (leading slash added automatically)
 * ```
 */
export function getApiUrl(endpoint: string): string {
  const baseUrl = getApiBaseUrl();
  const cleanEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
  return `${baseUrl}${cleanEndpoint}`;
}
