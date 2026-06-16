import { ConfigService } from '@nestjs/config';

export interface AppConfig {
  port: number;
  backendUrl: string;
  frontendUrl: string;
  sessionSecret: string;
  corsOrigins: string[];
  allowedRedirectUrls: string[];
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

export const createAppConfig = (configService: ConfigService): AppConfig => {
  const parsePort = (value: string | number | undefined, fallback: number) => {
    const parsed =
      typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const port = parsePort(configService.get<string | number>('PORT'), 3000);
  const backendUrl = configService.get<string>('BACKEND_URL');
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const sessionSecret = configService.get<string>('SESSION_SECRET');

  // Redis configuration
  const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
  const redisPort = parsePort(
    configService.get<string | number>('REDIS_PORT'),
    6379,
  );
  const redisPassword = configService.get<string>('REDIS_PASSWORD');

  // Validate required environment variables
  if (!backendUrl) {
    throw new Error('BACKEND_URL environment variable is required');
  }

  if (!frontendUrl) {
    throw new Error('FRONTEND_URL environment variable is required');
  }

  if (!sessionSecret) {
    throw new Error('SESSION_SECRET environment variable is required');
  }

  // Parse CORS origins from environment or use default
  const corsOriginsEnv = configService.get<string>('CORS_ORIGINS');
  const parsedCorsOrigins =
    corsOriginsEnv
      ?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? [];
  const corsOrigins =
    parsedCorsOrigins.length > 0 ? parsedCorsOrigins : [frontendUrl];

  const allowedRedirectUrlsEnv = configService.get<string>(
    'ALLOWED_REDIRECT_URLS',
    '',
  );
  const allowedRedirectUrls = (
    allowedRedirectUrlsEnv
      ? allowedRedirectUrlsEnv.split(',').map((url) => url.trim())
      : [frontendUrl]
  ).filter((url) => url.length > 0);

  return {
    port,
    backendUrl,
    frontendUrl,
    sessionSecret,
    corsOrigins,
    allowedRedirectUrls,
    redis: {
      host: redisHost,
      port: redisPort,
      ...(redisPassword && { password: redisPassword }),
    },
  };
};
