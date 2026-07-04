import { ConfigService } from '@nestjs/config';

export interface AppConfig {
  port: number;
  backendUrl: string;
  apiBaseUrl: string;
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

export const API_GLOBAL_PREFIX = 'api';

export const createAppConfig = (configService: ConfigService): AppConfig => {
  const parsePort = (value: string | number | undefined, fallback: number) => {
    const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);

    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const port = parsePort(configService.get<string | number>('PORT'), 3000);
  const backendUrl = configService.get<string>('BACKEND_URL');
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const sessionSecret = configService.get<string>('SESSION_SECRET');

  // Redis configuration
  const redisHost = configService.get<string>('REDIS_HOST', 'localhost');
  const redisPort = parsePort(configService.get<string | number>('REDIS_PORT'), 6379);
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

  const normalizedBackendUrl = normalizePublicUrl('BACKEND_URL', backendUrl);
  const apiBaseUrl = createApiBaseUrl(normalizedBackendUrl);

  // Parse CORS origins from environment or use default
  const corsOriginsEnv = configService.get<string>('CORS_ORIGINS');
  const parsedCorsOrigins =
    corsOriginsEnv
      ?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? [];
  const corsOrigins = parsedCorsOrigins.length > 0 ? parsedCorsOrigins : [frontendUrl];

  const allowedRedirectUrlsEnv = configService.get<string>('ALLOWED_REDIRECT_URLS', '');
  const allowedRedirectUrls = (
    allowedRedirectUrlsEnv ? allowedRedirectUrlsEnv.split(',').map((url) => url.trim()) : [frontendUrl]
  ).filter((url) => url.length > 0);

  return {
    port,
    backendUrl: normalizedBackendUrl,
    apiBaseUrl,
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

export function createApiBaseUrl(backendUrl: string): string {
  const normalizedBackendUrl = normalizePublicUrl('BACKEND_URL', backendUrl);
  const url = new URL(normalizedBackendUrl);
  const apiPrefix = API_GLOBAL_PREFIX.replace(/^\/+|\/+$/g, '');
  const segments = url.pathname.split('/').filter(Boolean);

  if (segments[segments.length - 1] !== apiPrefix) {
    segments.push(apiPrefix);
  }

  url.pathname = `/${segments.join('/')}`;
  return trimTrailingSlash(url.toString());
}

function normalizePublicUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} environment variable must be a valid absolute URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} environment variable must use http or https`);
  }

  if (url.search || url.hash) {
    throw new Error(`${name} environment variable must not include query or hash`);
  }

  return trimTrailingSlash(url.toString());
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
