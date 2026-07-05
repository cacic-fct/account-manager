import { Logger, LogLevel, type INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerCustomOptions, SwaggerModule } from '@nestjs/swagger';
import RedisStoreModule from 'connect-redis';
import type { Express, NextFunction, Request, Response } from 'express';
import session, { Store } from 'express-session';
import { createClient } from 'redis';
import { AppModule } from '../app.module';
import { createAppConfig } from '../config/app.config';
import {
  configureAccountBackendCommonHttpApp,
  getAccountBackendGlobalPrefix,
} from './account-backend-common-http-app';

export { configureAccountBackendCommonHttpApp, getAccountBackendGlobalPrefix };

type RedisStoreConstructor = new (options: { client: unknown; prefix: string }) => Store;

const RedisStore =
  (RedisStoreModule as unknown as { RedisStore?: RedisStoreConstructor }).RedisStore ??
  (RedisStoreModule as unknown as RedisStoreConstructor);

export interface ConfigureAccountBackendHttpAppOptions {
  configureSession?: boolean;
  configureSwagger?: boolean;
  configureTrackingCors?: boolean;
  configureCors?: boolean;
  registerShutdownHandlers?: boolean;
}

export async function createAccountBackendHttpApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule);
  await configureAccountBackendHttpApp(app);
  return app;
}

export async function configureAccountBackendHttpApp(
  app: INestApplication,
  options: ConfigureAccountBackendHttpAppOptions = {},
): Promise<void> {
  const {
    configureSession = true,
    configureSwagger = true,
    configureTrackingCors = true,
    configureCors = true,
    registerShutdownHandlers = true,
  } = options;

  const bootstrapLogger = new Logger('Bootstrap');
  configureAccountBackendLogger(app);
  configureAccountBackendCommonHttpApp(app);

  const configService = app.get(ConfigService);
  const appConfig = createAppConfig(configService);

  if (configureTrackingCors) {
    setupTrackingCors(app, configService, appConfig.corsOrigins);
  }

  const shouldTrustProxy = shouldEnableTrustProxy(configService, process.env.NODE_ENV ?? 'development');
  if (shouldTrustProxy) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', 1);
    bootstrapLogger.log('Trust proxy enabled for secure cookie support');
  }

  if (configureSwagger) {
    setupSwagger(app);
  }

  if (configureCors) {
    app.enableCors({
      origin: appConfig.corsOrigins,
      credentials: true,
    });
  }

  if (!configureSession) {
    return;
  }

  const redisClient = await createRedisClient(appConfig.redis);
  app.use(
    session({
      store: new RedisStore({
        client: redisClient,
        prefix: 'cacic:session:',
      }),
      secret: appConfig.sessionSecret,
      proxy: shouldTrustProxy,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
      },
    }),
  );

  if (registerShutdownHandlers) {
    registerGracefulShutdownHandlers(app, redisClient, bootstrapLogger);
  }
}

function configureAccountBackendLogger(app: INestApplication): void {
  const environment = process.env.NODE_ENV ?? 'development';
  const logLevels: LogLevel[] =
    environment === 'production'
      ? ['log', 'error', 'warn', 'fatal']
      : ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  Logger.overrideLogger(logLevels);
  app.useLogger(logLevels);
}

function setupSwagger(app: INestApplication): void {
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CACiC Account Manager API')
    .setDescription(
      'API for CACiC Account Manager - A comprehensive user management system with Keycloak integration and LGPD compliance features.',
    )
    .setVersion('1.0')
    .addTag('Authentication', 'User authentication and profile management')
    .addTag('LGPD (Data Protection)', 'LGPD data requests and user privacy')
    .addTag('Health Check', 'System health and status endpoints')
    .addCookieAuth()
    .build();
  const documentFactory = () => SwaggerModule.createDocument(app, swaggerConfig);
  const swaggerCustomOptions: SwaggerCustomOptions = {
    useGlobalPrefix: true,
    swaggerOptions: {
      persistAuthorization: true,
      tagsSorter: 'alpha',
      operationsSorter: 'alpha',
    },
  };
  SwaggerModule.setup('swagger', app, documentFactory, swaggerCustomOptions);
}

function setupTrackingCors(app: INestApplication, configService: ConfigService, corsOrigins: string[]): void {
  const allowedOrigins = new Set([
    'https://account.cacic.dev.br',
    'https://cacic.dev.br',
    'https://eventos.cacic.dev.br',
    'https://manual.cacic.dev.br',
    'https://secompp.cacic.dev.br',
    'https://voto.cacic.dev.br',
    ...corsOrigins,
    ...readOriginList(configService.get<string>('CACIC_TRACKING_CORS_ORIGINS')),
  ]);

  app.use('/api/tracking', (request: Request, response: Response, next: NextFunction) => {
    const origin = request.headers.origin;

    if (origin && allowedOrigins.has(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Access-Control-Allow-Credentials', 'true');
      response.setHeader('Access-Control-Allow-Headers', 'Accept, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.setHeader('Vary', 'Origin');
    }

    if (request.method === 'OPTIONS') {
      response.sendStatus(204);
      return;
    }

    next();
  });
}

function shouldEnableTrustProxy(configService: ConfigService, environment: string): boolean {
  const trustProxyEnv = configService.get<string>('TRUST_PROXY');
  return trustProxyEnv !== undefined
    ? trustProxyEnv === '1' || trustProxyEnv.toLowerCase() === 'true'
    : environment === 'production';
}

async function createRedisClient(redis: { host: string; port: number; password?: string }) {
  const redisClient = createClient({
    socket: {
      host: redis.host,
      port: redis.port,
    },
    ...(redis.password && { password: redis.password }),
  });

  const redisLogger = new Logger('RedisClient');
  redisClient.on('error', (error) => {
    redisLogger.error('Redis connection error', error);
  });
  redisClient.on('connect', () => {
    redisLogger.log('Connected to Redis');
  });
  redisClient.on('reconnecting', () => {
    redisLogger.warn('Reconnecting to Redis...');
  });

  try {
    await redisClient.connect();
  } catch (error) {
    redisLogger.fatal('Failed to connect to Redis', error);
    process.exit(1);
  }

  return redisClient;
}

function registerGracefulShutdownHandlers(
  app: INestApplication,
  redisClient: Awaited<ReturnType<typeof createRedisClient>>,
  bootstrapLogger: Logger,
): void {
  const shutdown = (signal: 'SIGTERM' | 'SIGINT') => {
    bootstrapLogger.warn(`Received ${signal}, shutting down gracefully...`);
    void (async () => {
      try {
        await redisClient.quit();
        await app.close();
        process.exit(0);
      } catch (error) {
        bootstrapLogger.error('Error during shutdown', error);
        process.exit(1);
      }
    })();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

function readOriginList(value: string | undefined): string[] {
  return (
    value
      ?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? []
  );
}
