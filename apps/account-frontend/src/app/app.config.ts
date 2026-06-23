import {
  ApplicationConfig,
  inject,
  provideAppInitializer,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideRouter } from '@angular/router';

import { routes } from './app.routes';
import {
  provideClientHydration,
  withEventReplay,
  withNoIncrementalHydration
} from '@angular/platform-browser';

import {
  provideHttpClient,
  withFetch,
  withInterceptors,
} from '@angular/common/http';
import { authAppInitializerFactory } from './shared/services/auth/auth-initializer';
import { AuthService } from './shared/services/auth/auth.service';
import { credentialsInterceptor } from './shared/interceptors/credentials.interceptor';
import { csrfInterceptor } from './shared/interceptors/csrf.interceptor';
import { MatIconRegistry } from '@angular/material/icon';

export const appConfig: ApplicationConfig = {
  providers: [
    provideAppInitializer(() => {
      const initializerFn = authAppInitializerFactory(inject(AuthService));
      return initializerFn();
    }),
    provideZonelessChangeDetection(),
    provideRouter(routes),
    provideClientHydration(withEventReplay(), withNoIncrementalHydration()),
    provideHttpClient(
      withFetch(),
      withInterceptors([credentialsInterceptor, csrfInterceptor]),
    ),
  ],
};
