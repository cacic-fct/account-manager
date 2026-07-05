import type { INestApplication } from '@nestjs/common';
import session from 'express-session';
import { configureAccountBackendCommonHttpApp } from '../../src/bootstrap/account-backend-common-http-app';

interface ConfigureAccountBackendTestAppOptions {
  session?: boolean;
}

export function configureAccountBackendTestApp(
  app: INestApplication,
  options: ConfigureAccountBackendTestAppOptions = {},
): void {
  configureAccountBackendCommonHttpApp(app);

  if (!options.session) {
    return;
  }

  app.use(
    session({
      secret: 'test-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        sameSite: 'lax',
      },
    }),
  );
}
