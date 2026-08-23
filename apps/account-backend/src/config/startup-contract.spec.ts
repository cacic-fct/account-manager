import { validateStartupConfig } from './startup-contract';

const baseConfig = (environment: 'development' | 'test' | 'production' = 'development'): Record<string, unknown> => ({
  NODE_ENV: environment,
  DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/account-manager',
  BACKEND_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:4200/app',
  SESSION_SECRET: 'test-session-secret',
  S3_ENDPOINT: 'http://localhost:8333',
  S3_ACCESS_KEY: 'access',
  S3_SECRET_KEY: 'secret',
  S3_BUCKET_NAME: 'account-manager',
});

const productionConfig = (): Record<string, unknown> => ({
  ...baseConfig('production'),
  KEYCLOAK_URL: 'https://sso.example.test',
  KEYCLOAK_REALM: 'cacic-sso',
  KEYCLOAK_CLIENT_ID: 'account-manager',
  KEYCLOAK_CLIENT_SECRET: 'client-secret',
  KEYCLOAK_ADMIN_CLIENT_ID: 'account-manager-admin',
  KEYCLOAK_ADMIN_CLIENT_SECRET: 'admin-secret',
  KEYCLOAK_M2M_CLIENT_ID: 'account-manager-m2m',
  KEYCLOAK_M2M_CLIENT_SECRET: 'm2m-secret',
  KEYCLOAK_M2M_ALLOWED_CLIENTS: 'event-manager-m2m,voto-m2m',
  KEYCLOAK_M2M_AUDIENCE: 'account-manager-audience',
  EVENT_MANAGER_GRPC_URL: 'event-manager:50051',
  EVENT_MANAGER_M2M_AUDIENCE: 'event-manager-audience',
  ACCOUNT_MANAGER_GRPC_BIND_URL: '0.0.0.0:50051',
  CACIC_GRPC_TLS_CA_CERT_PATH: '/run/secrets/ca.pem',
  CACIC_GRPC_TLS_CERT_PATH: '/run/secrets/server.pem',
  CACIC_GRPC_TLS_KEY_PATH: '/run/secrets/server-key.pem',
  REDIS_HOST: 'redis',
  REDIS_PORT: '6379',
  ACCOUNT_MERGE_GRPC_BACKENDS: '[]',
  LGPD_GRPC_BACKENDS: '[]',
  LGPD_DELETION_GRPC_BACKENDS: '[]',
});

describe('startup configuration contract', () => {
  it.each(['development', 'test'] as const)('accepts the minimal %s contract', (environment) => {
    expect(validateStartupConfig(baseConfig(environment))).toEqual(baseConfig(environment));
  });

  it('accepts the complete production contract', () => {
    expect(validateStartupConfig(productionConfig())).toMatchObject({ NODE_ENV: 'production' });
  });

  it.each(['DATABASE_URL', 'SESSION_SECRET', 'S3_ENDPOINT', 'S3_ACCESS_KEY', 'S3_SECRET_KEY', 'S3_BUCKET_NAME'])(
    'rejects a missing shared dependency setting: %s',
    (name) => {
      const config = baseConfig();
      delete config[name];

      expect(() => validateStartupConfig(config)).toThrow(`Startup configuration is incomplete`);
    },
  );

  it('rejects malformed cross-field and dynamic backend configuration', () => {
    expect(() => validateStartupConfig({ ...baseConfig(), DISCORD_BOT_TOKEN: 'token' })).toThrow(
      'DISCORD_BOT_TOKEN and DISCORD_GUILD_ID',
    );
    expect(() => validateStartupConfig({ ...baseConfig(), LGPD_GRPC_BACKENDS: '{broken' })).toThrow(
      'LGPD_GRPC_BACKENDS must be valid JSON',
    );
    expect(() =>
      validateStartupConfig({
        ...baseConfig(),
        LGPD_DELETION_GRPC_BACKENDS: JSON.stringify([{ name: 'event-manager', target: 'event-manager:50051' }]),
      }),
    ).toThrow('actions must contain only');
  });

  it('rejects production configuration that would silently fall back to insecure dependencies', () => {
    const config = productionConfig();
    delete config.KEYCLOAK_CLIENT_SECRET;

    expect(() => validateStartupConfig(config)).toThrow('KEYCLOAK_CLIENT_SECRET');
  });
});
