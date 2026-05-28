import { HttpInterceptorFn } from '@angular/common/http';
import { environment } from '../../../environments/environment';

export const credentialsInterceptor: HttpInterceptorFn = (req, next) => {
  // Add credentials to requests to our API
  if (req.url.includes(environment.apiUrl)) {
    // Don't set Content-Type for FormData requests (file uploads)
    // The browser will automatically set the correct multipart/form-data header
    const headers: { [key: string]: string } = {};

    if (!(req.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
    }

    req = req.clone({
      setHeaders: headers,
      withCredentials: true,
    });
  }

  return next(req);
};
