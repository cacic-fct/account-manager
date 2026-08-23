import { ConfigService } from '@nestjs/config';

export interface AppConfig {
  port: number;
  backendUrl: string;
  apiBaseUrl: string;
  frontendUrl: string;
  sessionSecret: string;
  corsOrigins: string[];
  allowedRedirectUrls: string[];
  swaggerEnabled: boolean;
  redis: {
    host: string;
    port: number;
    password?: string;
  };
}

export const API_GLOBAL_PREFIX = 'api';

export const createAppConfig = (configService: ConfigService): AppConfig => {
  const environment = configService.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? 'development';
  const parsePort = (name: string, value: string | number | undefined, fallback: number) => {
    if (value === undefined || value === '') {
      return fallback;
    }

    if (
      (typeof value === 'string' && !/^\d+$/.test(value)) ||
      (typeof value === 'number' && !Number.isInteger(value))
    ) {
      throw new Error(`${name} environment variable must be an integer port`);
    }

    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
      throw new Error(`${name} environment variable must be between 1 and 65535`);
    }

    return parsed;
  };

  const port = parsePort('PORT', configService.get<string | number>('PORT'), 3000);
  const backendUrl = configService.get<string>('BACKEND_URL');
  const frontendUrl = configService.get<string>('FRONTEND_URL');
  const sessionSecret = configService.get<string>('SESSION_SECRET');

  // Redis configuration
  const configuredRedisHost = configService.get<string>('REDIS_HOST');
  const configuredRedisPort = configService.get<string | number>('REDIS_PORT');
  if (environment === 'production' && (!configuredRedisHost || configuredRedisPort === undefined)) {
    throw new Error('REDIS_HOST and REDIS_PORT environment variables are required in production');
  }
  const redisHost = configuredRedisHost || 'localhost';
  const redisPort = parsePort('REDIS_PORT', configuredRedisPort, 6379);
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
  const normalizedFrontendUrl = normalizePublicUrl('FRONTEND_URL', frontendUrl);
  const apiBaseUrl = createApiBaseUrl(normalizedBackendUrl);

  // Parse CORS origins from environment or use default
  const corsOriginsEnv = configService.get<string>('CORS_ORIGINS');
  const parsedCorsOrigins =
    corsOriginsEnv
      ?.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0) ?? [];
  const corsOrigins = (parsedCorsOrigins.length > 0 ? parsedCorsOrigins : [new URL(normalizedFrontendUrl).origin]).map(
    (origin, index) => normalizeOrigin(`CORS_ORIGINS[${index}]`, origin),
  );

  const allowedRedirectUrlsEnv = configService.get<string>('ALLOWED_REDIRECT_URLS', '');
  const allowedRedirectUrls = (
    allowedRedirectUrlsEnv ? allowedRedirectUrlsEnv.split(',').map((url) => url.trim()) : [normalizedFrontendUrl]
  )
    .filter((url) => url.length > 0)
    .map((url, index) => normalizePublicUrl(`ALLOWED_REDIRECT_URLS[${index}]`, url));
  const swaggerEnabled = readBoolean(
    'SWAGGER_ENABLED',
    configService.get<string>('SWAGGER_ENABLED'),
    environment !== 'production',
  );

  return {
    port,
    backendUrl: normalizedBackendUrl,
    apiBaseUrl,
    frontendUrl: normalizedFrontendUrl,
    sessionSecret,
    corsOrigins,
    allowedRedirectUrls,
    swaggerEnabled,
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

  if (url.username || url.password || url.search || url.hash) {
    throw new Error(`${name} environment variable must not include credentials, query, or hash`);
  }

  return trimTrailingSlash(url.toString());
}

function normalizeOrigin(name: string, value: string): string {
  const normalized = normalizePublicUrl(name, value);
  const url = new URL(normalized);
  if (url.pathname !== '/' || url.username || url.password) {
    throw new Error(`${name} must be an origin without a path or credentials`);
  }
  return url.origin;
}

function readBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }
  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }
  throw new Error(`${name} environment variable must be a boolean`);
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}
