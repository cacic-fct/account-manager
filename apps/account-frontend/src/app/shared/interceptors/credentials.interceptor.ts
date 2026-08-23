import { HttpInterceptorFn } from '@angular/common/http';
import { isConfiguredApiRequest } from '../utils/request-url.util';

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  // Add credentials to requests to our API
  if (isConfiguredApiRequest(req.url)) {
    // Let Angular/browser infer the content type. In particular, bodyless
    // requests and non-JSON payloads must not be relabeled as JSON.
    const headers: { [key: string]: string } = {};

    if (req.body !== null && req.body !== undefined && !(req.body instanceof FormData)) {
      const isJsonBody =
        Array.isArray(req.body) || Object.prototype.toString.call(req.body) === '[object Object]';

      if (isJsonBody) {
        headers['Content-Type'] = 'application/json';
      }
    }

    req = req.clone({
      setHeaders: headers,
      withCredentials: true,
    });
  }

  return next(req);
};
