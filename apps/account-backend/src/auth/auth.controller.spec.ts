import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthController, AuthSession } from './auth.controller';
import { AccountPermissionService } from './services/account-permission.service';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { TotpService } from '../totp/totp.service';
import { RedisService } from '../redis/redis.service';

type KeycloakServiceMock = Pick<
  jest.Mocked<KeycloakService>,
  'exchangeCodeForTokens' | 'getUserInfo' | 'getAuthUrl' | 'getUserApplications' | 'getEndSessionUrl'
>;

type UserServiceMock = Pick<
  jest.Mocked<UserService>,
  'findByKeycloakId' | 'createFromKeycloak' | 'updateFromKeycloakOAuth' | 'checkOnboardingStatus'
>;

const createController = (configOverrides: Record<string, string> = {}) => {
  const keycloakService: KeycloakServiceMock = {
    exchangeCodeForTokens: jest.fn(),
    getUserInfo: jest.fn(),
    getAuthUrl: jest.fn(),
    getUserApplications: jest.fn(),
    getEndSessionUrl: jest.fn().mockReturnValue('https://sso.example.test/logout'),
  };
  const userService: UserServiceMock = {
    findByKeycloakId: jest.fn(),
    createFromKeycloak: jest.fn(),
    updateFromKeycloakOAuth: jest.fn(),
    checkOnboardingStatus: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      const values: Record<string, string> = {
        BACKEND_URL: 'http://localhost:3000',
        FRONTEND_URL: 'http://localhost:4200/',
        SESSION_SECRET: 'test-session-secret',
        ...configOverrides,
      };

      return values[key] ?? defaultValue;
    }),
  };
  const accountPermissionService = {} as AccountPermissionService;
  const totpService = {
    getOrCreateSeed: jest.fn().mockResolvedValue(undefined),
  } as unknown as TotpService;
  const redisService = {
    incrementWithExpiry: jest
      .fn<ReturnType<RedisService['incrementWithExpiry']>, Parameters<RedisService['incrementWithExpiry']>>()
      .mockResolvedValue(1),
  };

  return {
    controller: new AuthController(
      keycloakService as unknown as KeycloakService,
      userService as unknown as UserService,
      configService as unknown as ConfigService,
      accountPermissionService,
      totpService,
      redisService as unknown as RedisService,
    ),
    keycloakService,
    userService,
    redisService,
  };
};

const createSession = (): AuthSession => ({
  oauthState: 'pending-state',
  oauthCodeVerifier: 'pending-verifier',
  redirectTo: 'http://localhost:4200/applications',
  silentLogin: true,
  save: jest.fn((callback: (err?: Error) => void) => callback()),
  regenerate: jest.fn((callback: (err?: Error) => void) => callback()),
  destroy: jest.fn(),
});

const createRedirectResponse = (): {
  res: Response;
  redirect: jest.Mock<void, [string]>;
} => {
  const redirect = jest.fn<void, [string]>();

  return {
    res: { redirect } as unknown as Response,
    redirect,
  };
};

describe('AuthController OAuth callback cleanup', () => {
  it('clears state and PKCE verifier together when malformed callbacks fail before state validation', async () => {
    const { controller, keycloakService } = createController();
    const session = createSession();
    const { res, redirect } = createRedirectResponse();

    await controller.callback('', 'attacker-state', '', session, res);

    expect(session.oauthState).toBeUndefined();
    expect(session.oauthCodeVerifier).toBeUndefined();
    expect(session.silentLogin).toBeUndefined();
    expect(session.redirectTo).toBeUndefined();
    expect(keycloakService.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('http://localhost:4200/login?error=auth_failed');
  });

  it('rotates the anonymous session before storing an authenticated principal', async () => {
    const { controller, keycloakService, userService } = createController();
    const session = createSession();
    const { res, redirect } = createRedirectResponse();
    const profile = {
      id: 'user-1',
      keycloakId: 'user-1',
      email: 'user@example.test',
      isOnboarded: true,
      displayName: 'User',
      fullname: 'User Test',
    };
    keycloakService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'new-access-token',
      refresh_token: 'new-refresh-token',
      id_token: 'new-id-token',
      expires_in: 300,
      refresh_expires_in: 600,
    });
    keycloakService.getUserInfo.mockResolvedValue({ sub: 'user-1' } as never);
    userService.findByKeycloakId.mockResolvedValue(profile as never);
    userService.updateFromKeycloakOAuth.mockResolvedValue(profile as never);
    userService.checkOnboardingStatus.mockResolvedValue({ needsOnboarding: false, missingFields: [] });

    await controller.callback('authorization-code', 'pending-state', '', session, res);

    expect(session.regenerate).toHaveBeenCalledTimes(1);
    expect(session.user).toEqual({
      keycloakId: 'user-1',
      email: 'user@example.test',
      isOnboarded: true,
    });
    expect(session.authenticatedAt).toEqual(expect.any(Number));
    expect(session.accessToken).toBe('new-access-token');
    expect(redirect).toHaveBeenCalledWith('http://localhost:4200/applications');
  });
});

describe('AuthController redirect policy', () => {
  it('enforces configured path prefixes and rejects ambiguous absolute URLs', () => {
    const { controller } = createController({
      FRONTEND_URL: 'https://account.example.test/app',
      ALLOWED_REDIRECT_URLS: 'https://account.example.test/app/settings',
    });
    const internals = controller as unknown as { resolveSafeReturnUrl: (value: string) => string | null };
    const resolve = (value: string) => internals.resolveSafeReturnUrl(value);

    expect(resolve('https://account.example.test/app/settings/security')).toBe(
      'https://account.example.test/app/settings/security',
    );
    expect(resolve('https://account.example.test/app/admin')).toBeNull();
    expect(resolve('https://account.example.test.attacker.test/app/settings')).toBeNull();
    expect(resolve('https://account.example.test/app/settings%2F..%2Fadmin')).toBeNull();
  });
});

describe('AuthController development password login policy', () => {
  it('is disabled unless explicitly opted in', () => {
    const { controller } = createController();
    const internals = controller as unknown as { isPasswordLoginEnabled: () => boolean };
    const isEnabled = () => internals.isPasswordLoginEnabled();

    expect(isEnabled()).toBe(false);
  });

  it('enforces the shared attempt limit before contacting Keycloak', async () => {
    const { controller, redisService } = createController({
      KEYCLOAK_PASSWORD_LOGIN_ENABLED: 'true',
    });
    redisService.incrementWithExpiry.mockResolvedValueOnce(6).mockResolvedValueOnce(1);
    const internals = controller as unknown as {
      consumePasswordLoginAttempt: (email: string, request: unknown) => Promise<void>;
    };
    const consume = (email: string, request: unknown) => internals.consumePasswordLoginAttempt(email, request);

    await expect(
      consume('user@example.test', {
        ip: '127.0.0.1',
        socket: {},
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe('AuthController logout', () => {
  it('expires the browser cookie but does not claim success when session-store destruction fails', () => {
    const { controller } = createController();
    const session: AuthSession = {
      user: {
        keycloakId: 'user-1',
        email: 'user@example.test',
        isOnboarded: true,
      },
      destroy: (callback) => callback(new Error('redis unavailable')),
    };
    const clearCookie = jest.fn();
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { clearCookie, status, json } as unknown as Response;

    controller.logout(session, undefined, response);

    expect(clearCookie).toHaveBeenCalledWith('connect.sid', expect.any(Object));
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        logoutUrl: 'https://sso.example.test/logout',
      }),
    );
  });
});

describe('AuthController applications', () => {
  it("uses Keycloak's canonical logoUri attribute and falls back when it is not configured", async () => {
    const { controller, keycloakService } = createController();
    keycloakService.getUserApplications.mockResolvedValue([
      {
        id: 'svg-app',
        clientId: 'svg-app',
        name: 'SVG app',
        baseUrl: 'https://example.org/svg-app',
        enabled: true,
        publicClient: true,
        attributes: {
          logoUri: '  https://example.org/app-logo.svg  ',
        },
      },
      {
        id: 'default-app',
        clientId: 'default-app',
        name: 'Default app',
        baseUrl: 'https://example.org/default-app',
        enabled: true,
        publicClient: true,
        attributes: {
          logoUri: '  ',
        },
      },
    ]);

    const applications = await controller.getUserApplications({
      user: {
        email: 'user@example.org',
        keycloakId: 'keycloak-user-1',
        isOnboarded: true,
      },
      destroy: jest.fn(),
    });

    expect(applications).toEqual([
      expect.objectContaining({
        id: 'svg-app',
        iconUrl: 'https://example.org/app-logo.svg',
      }),
      expect.objectContaining({
        id: 'default-app',
        iconUrl: '/app/assets/default-app-icon.svg',
      }),
    ]);
  });
});
