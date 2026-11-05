import { ValidationPipe, type INestApplication } from '@nestjs/common';
import * as express from 'express';
import { API_GLOBAL_PREFIX } from '../config/app.config';

export function configureAccountBackendCommonHttpApp(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
  // Session-specific responses, including guard failures, must be checked again
  // on every navigation rather than reused by a browser or reverse proxy.
  app.use((_request: express.Request, response: express.Response, next: express.NextFunction) => {
    response.setHeader('Cache-Control', 'no-store, private');
    response.vary('Cookie');
    response.vary('Authorization');
    next();
  });
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ limit: '15mb', extended: true }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
}

export function getAccountBackendGlobalPrefix(): string {
  return API_GLOBAL_PREFIX;
}
