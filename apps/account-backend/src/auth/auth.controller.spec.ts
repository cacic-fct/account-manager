import { ExecutionContext } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from './guards/auth.guard';
import { CsrfGuard } from './csrf/csrf.guard';
import { CsrfService } from './csrf/csrf.service';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthController, AuthRequest, AuthSession } from './auth.controller';
import { AccountPermissionService } from './services/account-permission.service';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { TotpService } from '../totp/totp.service';
import { RedisService } from '../redis/redis.service';

type KeycloakServiceMock = Pick<
  jest.Mocked<KeycloakService>,
  'exchangeCodeForTokens' | 'getUserInfo' | 'getAuthUrl' | 'getUserApplications' | 'getEndSessionUrl' | 'logout'
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
    logout: jest.fn().mockResolvedValue(undefined),
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

describe('AuthController TOTP rotation login', () => {
  it('forces a fresh Keycloak login and binds the request to the current account', async () => {
    const { controller, keycloakService } = createController({ FRONTEND_URL: 'http://localhost:4200/app/' });
    const session = createSession();
    session.user = { keycloakId: 'user-1', email: 'user@example.test', isOnboarded: true };
    session.totpRotationAuthenticatedAt = Date.now();
    const { res } = createRedirectResponse();

    await controller.redirectToLogin(
      '/settings/security/totp?totpRotation=confirm',
      'none',
      session,
      res,
      'rotate-totp',
    );

    expect(session.pendingTotpRotationUserId).toBe('user-1');
    expect(session.totpRotationAuthenticatedAt).toBeUndefined();
    expect(session.silentLogin).toBe(false);
    expect(session.redirectTo).toBe('http://localhost:4200/app/settings/security/totp?totpRotation=confirm');
    const options = keycloakService.getAuthUrl.mock.calls[0]?.[2];
    expect(options).toMatchObject({ prompt: 'login', maxAge: 0 });
    expect(typeof options?.codeChallenge).toBe('string');
  });

  it('rejects rotation login without an existing authenticated account', async () => {
    const { controller, keycloakService } = createController();
    const { res } = createRedirectResponse();

    await expect(
      controller.redirectToLogin('/settings/security/totp', '', createSession(), res, 'rotate-totp'),
    ).rejects.toMatchObject({ status: 401 });
    expect(keycloakService.getAuthUrl).not.toHaveBeenCalled();
  });

  it('clears pending rotation when another login flow starts', async () => {
    const { controller } = createController();
    const session = createSession();
    session.pendingTotpRotationUserId = 'user-1';
    session.totpRotationAuthenticatedAt = Date.now();
    const { res } = createRedirectResponse();

    await controller.silentLogin('/applications', '', session, res);

    expect(session.pendingTotpRotationUserId).toBeUndefined();
    expect(session.totpRotationAuthenticatedAt).toBeUndefined();
  });

  it('does not authorize rotation when Keycloak returns a different account', async () => {
    const { controller, keycloakService } = createController();
    const session = createSession();
    session.pendingTotpRotationUserId = 'user-1';
    const request = { session } as unknown as AuthRequest;
    const { res, redirect } = createRedirectResponse();
    keycloakService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'token',
      refresh_token: 'refresh',
      id_token: 'id',
    });
    keycloakService.getUserInfo.mockResolvedValue({ sub: 'other-user' } as never);

    await controller.callback('code', 'pending-state', '', session, request, res);

    expect(session.pendingTotpRotationUserId).toBeUndefined();
    expect(session.totpRotationAuthenticatedAt).toBeUndefined();
    expect(session.regenerate).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('http://localhost:4200/login?error=auth_failed');
  });
});

describe('AuthController OAuth callback cleanup', () => {
  it('clears state and PKCE verifier together when malformed callbacks fail before state validation', async () => {
    const { controller, keycloakService } = createController();
    const session = createSession();
    session.pendingTotpRotationUserId = 'user-1';
    const request = { session } as unknown as AuthRequest;
    const { res, redirect } = createRedirectResponse();

    await controller.callback('', 'attacker-state', '', session, request, res);

    expect(session.oauthState).toBeUndefined();
    expect(session.oauthCodeVerifier).toBeUndefined();
    expect(session.silentLogin).toBeUndefined();
    expect(session.redirectTo).toBeUndefined();
    expect(session.pendingTotpRotationUserId).toBeUndefined();
    expect(keycloakService.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith('http://localhost:4200/login?error=auth_failed');
  });

  it.each([false, true])(
    'regenerates the session and only grants explicitly requested rotation (%s)',
    async (rotation) => {
      const { controller, keycloakService, userService } = createController();
      const session = createSession();
      if (rotation) {
        session.pendingTotpRotationUserId = 'user-1';
      }
      const regeneratedSession = createSession();
      const request = { session } as unknown as AuthRequest;
      session.regenerate = jest.fn((callback: (err?: Error) => void) => {
        request.session = regeneratedSession;
        callback();
      });
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

      await controller.callback('authorization-code', 'pending-state', '', session, request, res);

      expect(session.regenerate).toHaveBeenCalledTimes(1);
      expect(session.user).toBeUndefined();
      expect(regeneratedSession.user).toEqual({
        keycloakId: 'user-1',
        email: 'user@example.test',
        isOnboarded: true,
      });
      expect(regeneratedSession.authenticatedAt).toEqual(expect.any(Number));
      expect(regeneratedSession.totpRotationAuthenticatedAt).toEqual(rotation ? expect.any(Number) : undefined);
      expect(session.pendingTotpRotationUserId).toBeUndefined();
      expect(regeneratedSession.accessToken).toBe('new-access-token');
      expect(regeneratedSession.save).toHaveBeenCalledTimes(1);
      expect(redirect).toHaveBeenCalledWith('http://localhost:4200/applications');
    },
  );
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
  it('requires authentication and a same-session CSRF token for logout', () => {
    const handler = Object.getOwnPropertyDescriptor(AuthController.prototype, 'logout')?.value as (
      ...args: Parameters<AuthController['logout']>
    ) => ReturnType<AuthController['logout']>;
    const guards = Reflect.getMetadata(GUARDS_METADATA, handler) as unknown[];
    expect(guards).toEqual([AuthGuard, CsrfGuard]);
    const request = { method: 'POST', headers: {} as Record<string, string>, session: { csrfToken: 'session-csrf' } };
    const context = {
      getHandler: () => handler,
      getClass: () => AuthController,
      getType: () => 'http',
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const guard = new CsrfGuard(new CsrfService(), new Reflector());

    expect(() => new AuthGuard().canActivate(context)).toThrow('Entre na sua conta para continuar.');
    expect(() => guard.canActivate(context)).toThrow('A verificação de segurança falhou.');
    request.headers['x-csrf-token'] = 'other-session-csrf';
    expect(() => guard.canActivate(context)).toThrow('A verificação de segurança falhou.');
    request.headers['x-csrf-token'] = 'session-csrf';
    expect(guard.canActivate(context)).toBe(true);
  });

  it('confirms global logout using the server refresh token and never forwards the ID token', async () => {
    const { controller, keycloakService } = createController();
    const session = createSession();
    session.refreshToken = 'server-refresh-token';
    session.idToken = 'private-id-token';
    session.destroy = jest.fn((callback) => callback());
    const response = { clearCookie: jest.fn(), json: jest.fn() } as unknown as Response;

    await controller.logout(session, undefined, response);

    expect(keycloakService.logout).toHaveBeenCalledWith('server-refresh-token');
    expect(keycloakService.getEndSessionUrl).toHaveBeenCalledWith('http://localhost:4200/');
    expect(response.json).toHaveBeenCalledWith({
      success: true,
      globalLogoutComplete: true,
      logoutUrl: 'https://sso.example.test/logout',
    });
    expect(JSON.stringify((response.json as jest.Mock).mock.calls)).not.toContain('private-id-token');
  });

  it.each(['provider unavailable', 'timeout', 'invalid_grant'])(
    'destroys the local session despite upstream logout failure: %s',
    async (failure) => {
      const { controller, keycloakService } = createController();
      const session = createSession();
      session.refreshToken = 'server-refresh-token';
      session.destroy = jest.fn((callback) => callback());
      keycloakService.logout.mockRejectedValue(new Error(failure));
      const clearCookie = jest.fn();
      const response = { clearCookie, json: jest.fn() } as unknown as Response;

      await controller.logout(session, undefined, response);

      expect(session.destroy).toHaveBeenCalled();
      expect(clearCookie).toHaveBeenCalledWith('connect.sid', expect.any(Object));
      expect(response.json).toHaveBeenCalledWith({
        success: true,
        globalLogoutComplete: false,
        logoutUrl: 'https://sso.example.test/logout',
      });
      expect((session.destroy as jest.Mock).mock.invocationCallOrder[0]).toBeLessThan(
        keycloakService.logout.mock.invocationCallOrder[0],
      );
    },
  );

  it('expires the browser cookie but does not claim success when session-store destruction fails', async () => {
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

    await controller.logout(session, undefined, response);

    expect(clearCookie).toHaveBeenCalledWith('connect.sid', expect.any(Object));
    expect(status).toHaveBeenCalledWith(503);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        cookieExpired: true,
        globalLogoutComplete: false,
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
