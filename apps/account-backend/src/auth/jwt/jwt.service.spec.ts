import { ConfigService } from '@nestjs/config';
import { JwtPayload, JwtService } from './jwt.service';

type ConfigValue = number | string | undefined;

const baseConfig: Record<string, ConfigValue> = {
  KEYCLOAK_URL: 'https://sso.example.test',
  KEYCLOAK_REALM: 'cacic-sso',
  KEYCLOAK_M2M_AUDIENCE: 'cacic-account-manager-audience',
  KEYCLOAK_M2M_ALLOWED_CLIENTS: 'cacic-event-manager-m2m',
};

const createConfigService = (overrides: Record<string, ConfigValue> = {}) =>
  ({
    get: jest.fn((key: string, defaultValue?: ConfigValue) => {
      const value = { ...baseConfig, ...overrides }[key];
      return value ?? defaultValue;
    }),
  }) as unknown as ConfigService;

const createPayload = (overrides: Partial<JwtPayload> = {}): JwtPayload => ({
  sub: 'service-account-subject',
  iss: 'https://sso.example.test/realms/cacic-sso',
  aud: 'cacic-account-manager-audience',
  exp: 4_102_444_800,
  iat: 1_767_228_000,
  azp: 'cacic-event-manager-m2m',
  preferred_username: 'service-account-cacic-event-manager-m2m',
  resource_access: {
    'cacic-account-manager-audience': {
      roles: ['privacy:write'],
    },
  },
  ...overrides,
});

describe('JwtService M2M authorization', () => {
  it('requires an explicit M2M audience', () => {
    expect(
      () =>
        new JwtService(
          createConfigService({
            KEYCLOAK_M2M_AUDIENCE: undefined,
          }),
        ),
    ).toThrow('KEYCLOAK_M2M_AUDIENCE must be configured');
  });

  it('requires an explicit M2M allowed-client list', () => {
    expect(
      () =>
        new JwtService(
          createConfigService({
            KEYCLOAK_M2M_ALLOWED_CLIENTS: '',
          }),
        ),
    ).toThrow('KEYCLOAK_M2M_ALLOWED_CLIENTS must be configured');
  });

  it('allows only configured M2M callers', () => {
    const service = new JwtService(createConfigService());

    expect(service.isAllowedM2MClient(createPayload())).toBe(true);
    expect(
      service.isAllowedM2MClient(
        createPayload({
          azp: 'unknown-client',
          preferred_username: 'service-account-unknown-client',
        }),
      ),
    ).toBe(false);
  });

  it('requires roles on the configured M2M audience client', () => {
    const service = new JwtService(createConfigService());

    expect(service.hasRequiredRole(createPayload(), 'privacy:write')).toBe(
      true,
    );
    expect(
      service.hasRequiredRole(
        createPayload({
          resource_access: {
            'unrelated-client': {
              roles: ['privacy:write'],
            },
          },
        }),
        'privacy:write',
      ),
    ).toBe(false);
  });

  it('does not accept realm roles for M2M endpoint authorization', () => {
    const service = new JwtService(createConfigService());

    expect(
      service.hasRequiredRole(
        createPayload({
          realm_access: {
            roles: ['privacy:write'],
          },
          resource_access: {},
        }),
        'privacy:write',
      ),
    ).toBe(false);
  });
});
