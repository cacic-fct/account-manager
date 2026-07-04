import type { ConfigService } from '@nestjs/config';
import type { KeycloakUser, UserProfile } from '../src/auth/interfaces/auth.interface';
import type { UserService } from '../src/auth/services/user.service';

type ConfigValue = boolean | number | string | undefined;

const defaultConfig: Record<string, ConfigValue> = {
  BACKEND_URL: 'http://localhost:3000',
  FRONTEND_URL: 'http://localhost:4200/app/',
  SESSION_SECRET: 'test-session-secret',
  ALLOWED_REDIRECT_URLS: 'http://localhost:4200/app/',
  KEYCLOAK_PASSWORD_LOGIN_ENABLED: 'true',
};

export function createAuthTestConfigService(overrides: Record<string, ConfigValue> = {}): ConfigService {
  const values = {
    ...defaultConfig,
    ...overrides,
  };

  return {
    get: jest.fn((key: string, defaultValue?: ConfigValue) => {
      return values[key] ?? defaultValue;
    }),
  } as unknown as ConfigService;
}

export function createKeycloakUser(input: { sub: string; email: string; name: string }): KeycloakUser {
  return {
    sub: input.sub,
    email: input.email,
    email_verified: true,
    name: input.name,
    preferred_username: input.email,
    given_name: input.name.split(' ')[0] ?? input.name,
    family_name: input.name.split(' ').slice(1).join(' '),
  };
}

export function createUserServiceFake(): Pick<
  UserService,
  'findByKeycloakId' | 'createFromKeycloak' | 'updateFromKeycloakOAuth' | 'checkOnboardingStatus'
> {
  const profiles = new Map<string, UserProfile>([
    [
      '22222222-2222-2222-2222-222222222222',
      createProfile({
        id: '22222222-2222-2222-2222-222222222222',
        email: 'aluno@unesp.br',
        fullname: 'Aluno Unesp',
        isOnboarded: true,
      }),
    ],
    [
      '44444444-4444-4444-4444-444444444444',
      createProfile({
        id: '44444444-4444-4444-4444-444444444444',
        email: 'externo@gmail.com',
        fullname: 'Usuario Externo',
        isOnboarded: false,
      }),
    ],
  ]);

  return {
    findByKeycloakId: jest.fn((id: string) => Promise.resolve(profiles.get(id) ?? null)),
    createFromKeycloak: jest.fn((user: KeycloakUser) => {
      const profile = createProfile({
        id: user.sub,
        email: user.email,
        fullname: user.name,
        isOnboarded: false,
      });
      profiles.set(user.sub, profile);
      return Promise.resolve(profile);
    }),
    updateFromKeycloakOAuth: jest.fn((user: KeycloakUser) => {
      const profile =
        profiles.get(user.sub) ??
        createProfile({
          id: user.sub,
          email: user.email,
          fullname: user.name,
          isOnboarded: false,
        });
      profiles.set(user.sub, profile);
      return Promise.resolve(profile);
    }),
    checkOnboardingStatus: jest.fn((id: string) => {
      const profile = profiles.get(id);

      return Promise.resolve(
        profile?.isOnboarded
          ? { needsOnboarding: false, missingFields: [] }
          : {
              needsOnboarding: true,
              missingFields: ['phone', 'identity-document'],
            },
      );
    }),
  };
}

export async function waitForKeycloakRealm(keycloakBaseUrl: string): Promise<void> {
  const metadataUrl = `${keycloakBaseUrl}/realms/cacic-sso/.well-known/openid-configuration`;
  const timeoutAt = Date.now() + 60_000;
  let lastError: unknown;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(metadataUrl);
      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }

  throw new Error(
    `Test Keycloak is not ready at ${metadataUrl}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function createProfile(input: { id: string; email: string; fullname: string; isOnboarded: boolean }): UserProfile {
  return {
    id: input.id,
    keycloakId: input.id,
    username: input.email,
    email: input.email,
    fullname: input.fullname,
    displayName: input.fullname,
    phone: input.isOnboarded ? '+5518999990002' : '',
    identityDocument: input.isOnboarded ? '22222222222' : '',
    isForeigner: false,
    isOnboarded: input.isOnboarded,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
}
