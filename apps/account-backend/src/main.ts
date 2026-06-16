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

  if (process.env.NODE_ENV === 'production') {
    void registerDiscordMetadata();
  }

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

/**
 * Registers Discord role connection metadata for the application.
 * This should be called once after deployment or when metadata changes.
 * Requires DISCORD_CLIENT_ID and DISCORD_BOT_TOKEN in environment variables.
 */
async function registerDiscordMetadata(): Promise<void> {
  const discordLogger = new Logger('DiscordMetadata');
  const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
  const DISCORD_BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
  if (!DISCORD_CLIENT_ID || !DISCORD_BOT_TOKEN) {
    discordLogger.warn(
      'Discord metadata registration skipped: missing DISCORD_CLIENT_ID or DISCORD_BOT_TOKEN',
    );
    return;
  }

  const url = `https://discord.com/api/v10/applications/${DISCORD_CLIENT_ID}/role-connections/metadata`;
  const body = [
    {
      key: 'has_unesp_email',
      name: 'Possui e-mail institucional',
      description: 'Possui e-mail @unesp.br?',
      type: 7,
    },
    {
      key: 'is_student',
      name: 'É aluno',
      description: 'É aluno da graduação?',
      type: 7,
    },
    {
      key: 'is_computer_science_student',
      name: 'É aluno da computação',
      description: 'É aluno do BCC?',
      type: 7,
    },
    {
      key: 'is_not_unesp_email',
      name: 'Não possui e-mail institucional',
      description: 'Precisa não possuir e-mail @unesp.br vinculado',
      type: 7,
    },
  ];

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bot ${DISCORD_BOT_TOKEN}`,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const errorText = await res.text();
      discordLogger.error(
        'Failed to register Discord metadata',
        res.status,
        errorText,
      );
    } else {
      discordLogger.log(
        'Discord role connection metadata registered successfully.',
      );
    }
  } catch (err) {
    discordLogger.error('Error registering Discord metadata', err);
  }
}
