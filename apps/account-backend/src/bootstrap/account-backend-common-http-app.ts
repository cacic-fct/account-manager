import { ValidationPipe, type INestApplication } from '@nestjs/common';
import * as express from 'express';
import { API_GLOBAL_PREFIX } from '../config/app.config';

export function configureAccountBackendCommonHttpApp(app: INestApplication): void {
  app.setGlobalPrefix(API_GLOBAL_PREFIX);
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
