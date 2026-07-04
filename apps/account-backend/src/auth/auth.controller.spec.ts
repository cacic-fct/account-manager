import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AuthController, AuthSession } from './auth.controller';
import { AccountPermissionService } from './services/account-permission.service';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { TotpService } from '../totp/totp.service';

type KeycloakServiceMock = Pick<jest.Mocked<KeycloakService>, 'exchangeCodeForTokens' | 'getUserInfo' | 'getAuthUrl'>;

type UserServiceMock = Pick<
  jest.Mocked<UserService>,
  'findByKeycloakId' | 'createFromKeycloak' | 'updateFromKeycloakOAuth'
>;

const createController = () => {
  const keycloakService: KeycloakServiceMock = {
    exchangeCodeForTokens: jest.fn(),
    getUserInfo: jest.fn(),
    getAuthUrl: jest.fn(),
  };
  const userService: UserServiceMock = {
    findByKeycloakId: jest.fn(),
    createFromKeycloak: jest.fn(),
    updateFromKeycloakOAuth: jest.fn(),
  };
  const configService = {
    get: jest.fn((key: string, defaultValue?: string | number) => {
      const values: Record<string, string> = {
        BACKEND_URL: 'http://localhost:3000',
        FRONTEND_URL: 'http://localhost:4200/',
        SESSION_SECRET: 'test-session-secret',
      };

      return values[key] ?? defaultValue;
    }),
  };
  const accountPermissionService = {} as AccountPermissionService;
  const totpService = {} as TotpService;

  return {
    controller: new AuthController(
      keycloakService as unknown as KeycloakService,
      userService as unknown as UserService,
      configService as unknown as ConfigService,
      accountPermissionService,
      totpService,
    ),
    keycloakService,
  };
};

const createSession = (): AuthSession => ({
  oauthState: 'pending-state',
  oauthCodeVerifier: 'pending-verifier',
  redirectTo: 'http://localhost:4200/applications',
  silentLogin: true,
  save: jest.fn((callback: (err?: Error) => void) => callback()),
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
});
