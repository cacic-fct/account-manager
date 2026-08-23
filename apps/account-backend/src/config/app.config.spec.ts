import { ConfigService } from '@nestjs/config';
import { createApiBaseUrl, createAppConfig } from './app.config';

type ConfigValue = number | string | undefined;

const createConfigService = (overrides: Record<string, ConfigValue> = {}) => {
  const values: Record<string, ConfigValue> = {
    BACKEND_URL: 'http://localhost:3000',
    FRONTEND_URL: 'http://localhost:4200/app',
    SESSION_SECRET: 'test-session-secret',
    ...overrides,
  };

  return {
    get: jest.fn((key: string, defaultValue?: ConfigValue) => {
      const value = values[key];
      return value ?? defaultValue;
    }),
  } as unknown as ConfigService;
};

describe('app config', () => {
  it('derives the public API base URL from a backend origin', () => {
    const config = createAppConfig(createConfigService());

    expect(config.backendUrl).toBe('http://localhost:3000');
    expect(config.apiBaseUrl).toBe('http://localhost:3000/api');
  });

  it('keeps BACKEND_URL idempotent when it already includes the API prefix', () => {
    expect(createApiBaseUrl('https://account.cacic.com.br/api')).toBe('https://account.cacic.com.br/api');
    expect(createApiBaseUrl('https://account.cacic.com.br/api/')).toBe('https://account.cacic.com.br/api');
  });

  it.each(['3000junk', '0', '65536', '-1'])('rejects malformed PORT value %s', (port) => {
    expect(() => createAppConfig(createConfigService({ PORT: port }))).toThrow('PORT environment variable');
  });

  it('normalizes frontend, CORS, and redirect URLs without losing allowed path prefixes', () => {
    const config = createAppConfig(
      createConfigService({
        FRONTEND_URL: 'https://account.example.test/app/',
        CORS_ORIGINS: 'https://account.example.test,https://events.example.test',
        ALLOWED_REDIRECT_URLS: 'https://account.example.test/app,https://events.example.test/registrations/',
      }),
    );

    expect(config.frontendUrl).toBe('https://account.example.test/app');
    expect(config.corsOrigins).toEqual(['https://account.example.test', 'https://events.example.test']);
    expect(config.allowedRedirectUrls).toEqual([
      'https://account.example.test/app',
      'https://events.example.test/registrations',
    ]);
  });

  it('rejects credentials and paths in CORS origins', () => {
    expect(() =>
      createAppConfig(createConfigService({ CORS_ORIGINS: 'https://user:secret@example.test/private' })),
    ).toThrow('CORS_ORIGINS[0]');
  });

  it('rejects malformed boolean startup configuration', () => {
    expect(() => createAppConfig(createConfigService({ SWAGGER_ENABLED: 'sometimes' }))).toThrow(
      'SWAGGER_ENABLED environment variable must be a boolean',
    );
  });

  it('requires explicit Redis configuration in production', () => {
    expect(() => createAppConfig(createConfigService({ NODE_ENV: 'production' }))).toThrow(
      'REDIS_HOST and REDIS_PORT environment variables are required in production',
    );
  });
});
