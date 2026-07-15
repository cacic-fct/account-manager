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
});
