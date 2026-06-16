import { NestFactory } from '@nestjs/core';
import {
  INestApplication,
  ValidationPipe,
  Logger,
  LogLevel,
} from '@nestjs/common';
import { AppModule } from './app.module';
import session, { Store } from 'express-session';
import RedisStoreModule from 'connect-redis';
import { createClient } from 'redis';
import {
  DocumentBuilder,
  SwaggerModule,
  SwaggerCustomOptions,
} from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { createAppConfig } from './config/app.config';
import * as express from 'express';
import type { Express } from 'express';

type RedisStoreConstructor = new (options: {
  client: unknown;
  prefix: string;
}) => Store;

const RedisStore =
  (RedisStoreModule as unknown as { RedisStore?: RedisStoreConstructor })
    .RedisStore ?? (RedisStoreModule as unknown as RedisStoreConstructor);

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const bootstrapLogger = new Logger('Bootstrap');
  const environment = process.env.NODE_ENV ?? 'development';
  const logLevels: LogLevel[] =
    environment === 'production'
      ? ['log', 'error', 'warn', 'fatal']
      : ['log', 'error', 'warn', 'debug', 'verbose', 'fatal'];

  Logger.overrideLogger(logLevels);
  app.useLogger(logLevels);
  app.setGlobalPrefix('api');

  // Configure body parser limits for file uploads
  app.use(express.json({ limit: '15mb' }));
  app.use(express.urlencoded({ limit: '15mb', extended: true }));

  const configService = app.get(ConfigService);
  const appConfig = createAppConfig(configService);

  const trustProxyEnv = configService.get<string>('TRUST_PROXY');
  const shouldTrustProxy =
    trustProxyEnv !== undefined
      ? trustProxyEnv === '1' || trustProxyEnv.toLowerCase() === 'true'
      : environment === 'production';

  if (shouldTrustProxy) {
    const expressApp = app.getHttpAdapter().getInstance() as Express;
    expressApp.set('trust proxy', 1);
    bootstrapLogger.log('Trust proxy enabled for secure cookie support');
  }

  setupSwagger(app);

  // Enable global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS for frontend
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  // Configure Redis client
  const redisClient = createClient({
    socket: {
      host: appConfig.redis.host,
      port: appConfig.redis.port,
    },
    ...(appConfig.redis.password && { password: appConfig.redis.password }),
  });

  const redisLogger = new Logger('RedisClient');

  redisClient.on('error', (err) => {
    redisLogger.error('Redis connection error', err);
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

  // Configure session with Redis store
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
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production' ? true : false,
        sameSite: 'lax',
      },
    }),
  );

  // Graceful shutdown
  process.on('SIGTERM', () => {
    bootstrapLogger.warn('Received SIGTERM, shutting down gracefully...');
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
  });

  process.on('SIGINT', () => {
    bootstrapLogger.warn('Received SIGINT, shutting down gracefully...');
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
  });

  await app.listen(appConfig.port);
  bootstrapLogger.log(`Application is running on: ${appConfig.backendUrl}`);
}
const bootstrapFailureLogger = new Logger('Bootstrap');

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  bootstrapFailureLogger.fatal(
    `Failed to bootstrap application: ${message}`,
    stack,
  );
  process.exit(1);
});

function setupSwagger(app: INestApplication<any>): void {
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
  const documentFactory = () =>
    SwaggerModule.createDocument(app, swaggerConfig);
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
