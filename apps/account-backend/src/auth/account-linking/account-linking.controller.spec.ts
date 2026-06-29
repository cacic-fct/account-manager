import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AccountMergeRequest } from '@cacic/shared-types';
import { AuthSession } from '../auth.controller';
import { CsrfService } from '../csrf/csrf.service';
import { AuthGuard } from '../guards/auth.guard';
import { CurrentUserGuard } from '../guards/current-user.guard';
import { KeycloakService } from '../services/keycloak.service';
import { UserService } from '../services/user.service';
import { AccountLinkingController } from './account-linking.controller';
import { AccountLinkingService } from './account-linking.service';

type KeycloakServiceMock = {
  getUserBasicInfo: jest.Mock;
  getEndSessionUrl: jest.Mock;
  getAuthUrl: jest.Mock<
    ReturnType<KeycloakService['getAuthUrl']>,
    Parameters<KeycloakService['getAuthUrl']>
  >;
  exchangeCodeForTokens: jest.Mock;
  getUserInfo: jest.Mock;
};

type UserServiceMock = {
  findByKeycloakId: jest.Mock;
  createFromKeycloak: jest.Mock;
  updateFromKeycloakOAuth: jest.Mock;
};

type AccountLinkingServiceMock = {
  getRequest: jest.Mock;
  createMergeRequest: jest.Mock;
  confirmMerge: jest.Mock;
  cancelRequest: jest.Mock;
};

const createSession = (keycloakId = 'secondary-user'): AuthSession => ({
  user: {
    id: 'local-secondary-user',
    email: 'secondary@example.com',
    keycloakId,
    isOnboarded: true,
  },
  destroy: jest.fn(),
});

const createMergeRequest = (): AccountMergeRequest => ({
  id: 'merge-request-1',
  status: 'completed',
  requesterUserId: 'secondary-user',
  candidateUserId: 'primary-user',
  primaryUserId: 'primary-user',
  secondaryUserId: 'secondary-user',
  primaryEmailOptions: ['primary@example.com', 'secondary@example.com'],
  selectedPrimaryEmail: 'primary@example.com',
  secondaryEmails: ['secondary@example.com'],
  notificationSummary: {
    pending: 0,
    completed: 0,
    failed: 0,
  },
  scores: [],
  externalScores: [],
  expiresAt: '2026-06-18T12:00:00.000Z',
  completedAt: '2026-06-18T12:05:00.000Z',
  createdAt: '2026-06-18T11:55:00.000Z',
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

describe('AccountLinkingController', () => {
  let app: INestApplication<App> | undefined;
  let session: AuthSession;
  let keycloakService: KeycloakServiceMock;
  let userService: UserServiceMock;
  let accountLinkingService: AccountLinkingServiceMock;
  let controller: AccountLinkingController;

  beforeEach(async () => {
    session = createSession();

    keycloakService = {
      getUserBasicInfo: jest.fn(),
      getEndSessionUrl: jest.fn(),
      getAuthUrl: jest.fn<
        ReturnType<KeycloakService['getAuthUrl']>,
        Parameters<KeycloakService['getAuthUrl']>
      >(),
      exchangeCodeForTokens: jest.fn(),
      getUserInfo: jest.fn(),
    };
    userService = {
      findByKeycloakId: jest.fn(),
      createFromKeycloak: jest.fn(),
      updateFromKeycloakOAuth: jest.fn(),
    };
    accountLinkingService = {
      getRequest: jest.fn(),
      createMergeRequest: jest.fn(),
      confirmMerge: jest.fn(),
      cancelRequest: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [AccountLinkingController],
      providers: [
        AuthGuard,
        CurrentUserGuard,
        {
          provide: KeycloakService,
          useValue: keycloakService,
        },
        {
          provide: UserService,
          useValue: userService,
        },
        {
          provide: AccountLinkingService,
          useValue: accountLinkingService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string, defaultValue?: string | number) => {
              const values: Record<string, string> = {
                BACKEND_URL: 'http://localhost:3000',
                FRONTEND_URL: 'http://localhost:4200',
                SESSION_SECRET: 'test-session-secret',
              };

              return values[key] ?? defaultValue;
            }),
          },
        },
        {
          provide: CsrfService,
          useValue: {
            validateToken: jest.fn().mockReturnValue(true),
          },
        },
      ],
    }).compile();

    controller = module.get(AccountLinkingController);
    app = module.createNestApplication();
    app.use((req: Request, _res: Response, next: NextFunction) => {
      Object.assign(req, { session });
      next();
    });
    await app.init();
  });

  afterEach(async () => {
    await app?.close();
    app = undefined;
  });

  it('blocks disabled pre-merge sessions before loading or switching a merge request', async () => {
    keycloakService.getUserBasicInfo.mockResolvedValue({
      id: 'secondary-user',
      email: 'secondary@example.com',
      enabled: false,
    });

    await request(app!.getHttpServer())
      .get('/auth/account-linking/merge-requests/merge-request-1')
      .expect(403);

    expect(accountLinkingService.getRequest).not.toHaveBeenCalled();
    expect(userService.findByKeycloakId).not.toHaveBeenCalled();
    expect(session.user?.keycloakId).toBe('secondary-user');
  });

  it('keeps the completed-merge session switch for enabled sessions', async () => {
    keycloakService.getUserBasicInfo.mockResolvedValue({
      id: 'secondary-user',
      email: 'secondary@example.com',
      enabled: true,
    });
    accountLinkingService.getRequest.mockResolvedValue(createMergeRequest());
    userService.findByKeycloakId.mockResolvedValue({
      id: 'local-primary-user',
      email: 'primary@example.com',
      keycloakId: 'primary-user',
      isOnboarded: true,
    });

    await request(app!.getHttpServer())
      .get('/auth/account-linking/merge-requests/merge-request-1')
      .expect(200);

    expect(accountLinkingService.getRequest).toHaveBeenCalledWith(
      'merge-request-1',
      'secondary-user',
    );
    expect(session.user).toEqual({
      id: 'local-primary-user',
      email: 'primary@example.com',
      keycloakId: 'primary-user',
      isOnboarded: true,
    });
  });

  it('starts Google linking by storing state and returning the Keycloak end-session URL', () => {
    keycloakService.getEndSessionUrl.mockReturnValue('https://sso/logout');
    session.idToken = 'id-token';

    const result = controller.startGoogleLinking(session);

    expect(session.accountLinkingState).toMatch(/^[a-f0-9]{64}$/);
    expect(session.accountLinkingUserId).toBe('secondary-user');
    expect(keycloakService.getEndSessionUrl).toHaveBeenCalledWith(
      expect.stringContaining('/auth/account-linking/google/resume?state='),
      'id-token',
    );
    expect(result).toEqual({ url: 'https://sso/logout' });
  });

  it('resumes Google linking with PKCE when the account-linking state matches', async () => {
    keycloakService.getAuthUrl.mockReturnValue('https://sso/auth');
    session.accountLinkingState = 'state-1';
    const { res, redirect } = createRedirectResponse();

    await controller.resumeGoogleLinking('state-1', session, res);

    const getAuthUrlCall = keycloakService.getAuthUrl.mock.calls[0];
    expect(getAuthUrlCall?.[0]).toBe(
      'http://localhost:3000/api/auth/account-linking/google/callback',
    );
    expect(getAuthUrlCall?.[1]).toBe('state-1');
    const getAuthUrlOptions = getAuthUrlCall?.[2];
    expect(getAuthUrlOptions).toMatchObject({
      prompt: 'login',
      maxAge: 0,
    });
    expect(getAuthUrlOptions?.codeChallenge).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(session.accountLinkingCodeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(redirect).toHaveBeenCalledWith('https://sso/auth');
  });

  it('saves the session before redirecting to the Google linking auth URL', async () => {
    keycloakService.getAuthUrl.mockReturnValue('https://sso/auth');
    session.accountLinkingState = 'state-1';
    session.save = jest.fn((callback: (error?: Error) => void) => {
      callback();
    });
    const { res, redirect } = createRedirectResponse();

    await controller.resumeGoogleLinking('state-1', session, res);

    expect(session.save).toHaveBeenCalledTimes(1);
    expect(redirect).toHaveBeenCalledWith('https://sso/auth');
  });

  it('clears state and redirects to failure when session save fails', async () => {
    keycloakService.getAuthUrl.mockReturnValue('https://sso/auth');
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';
    session.accountLinkingCodeVerifier = 'verifier-1';
    session.save = jest.fn((callback: (error?: Error) => void) => {
      callback(new Error('save failed'));
    });
    const { res, redirect } = createRedirectResponse();

    await controller.resumeGoogleLinking('state-1', session, res);

    expect(session.accountLinkingState).toBeUndefined();
    expect(session.accountLinkingUserId).toBeUndefined();
    expect(session.accountLinkingCodeVerifier).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=failed',
    );
  });

  it('clears account-linking state and redirects to failure when resume state is invalid', async () => {
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';
    session.accountLinkingCodeVerifier = 'verifier-1';
    const { res, redirect } = createRedirectResponse();

    await controller.resumeGoogleLinking('bad-state', session, res);

    expect(session.accountLinkingState).toBeUndefined();
    expect(session.accountLinkingUserId).toBeUndefined();
    expect(session.accountLinkingCodeVerifier).toBeUndefined();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=failed',
    );
  });

  it('creates a merge request for a newly authenticated different Google account', async () => {
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';
    session.accountLinkingCodeVerifier = 'verifier-1';
    keycloakService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'access-token',
    });
    keycloakService.getUserInfo.mockResolvedValue({
      sub: 'candidate-user',
      email: 'candidate@example.com',
    });
    userService.findByKeycloakId.mockResolvedValue(null);
    userService.createFromKeycloak.mockResolvedValue({
      id: 'local-candidate',
      email: 'candidate@example.com',
      keycloakId: 'candidate-user',
      isOnboarded: true,
    });
    accountLinkingService.createMergeRequest.mockResolvedValue({
      id: 'merge-request-1',
    });
    const { res, redirect } = createRedirectResponse();

    await controller.googleCallback('code-1', 'state-1', '', session, res);

    expect(keycloakService.exchangeCodeForTokens).toHaveBeenCalledWith(
      'code-1',
      'http://localhost:3000/api/auth/account-linking/google/callback',
      'verifier-1',
    );
    expect(accountLinkingService.createMergeRequest).toHaveBeenCalledWith(
      'secondary-user',
      'candidate-user',
    );
    expect(redirect).toHaveBeenLastCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=merge-required&merge_request=merge-request-1',
    );
  });

  it('redirects account-linking callback failures and session-expired callbacks safely', async () => {
    const { res, redirect } = createRedirectResponse();
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = undefined;

    await controller.googleCallback('code-1', 'state-1', '', session, res);

    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=failed',
    );
    expect(session.accountLinkingState).toBeUndefined();
  });

  it('redirects OAuth callback errors without exchanging tokens', async () => {
    const { res, redirect } = createRedirectResponse();
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';

    await controller.googleCallback(
      '',
      'state-1',
      'access_denied',
      session,
      res,
    );

    expect(keycloakService.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=failed',
    );
  });

  it('clears state and redirects to failure when callback state is invalid', async () => {
    const { res, redirect } = createRedirectResponse();
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';
    session.accountLinkingCodeVerifier = 'verifier-1';

    await controller.googleCallback('code-1', 'bad-state', '', session, res);

    expect(session.accountLinkingState).toBeUndefined();
    expect(session.accountLinkingUserId).toBeUndefined();
    expect(session.accountLinkingCodeVerifier).toBeUndefined();
    expect(keycloakService.exchangeCodeForTokens).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=failed',
    );
  });

  it('redirects already-linked Google accounts without creating a merge request', async () => {
    session.accountLinkingState = 'state-1';
    session.accountLinkingUserId = 'secondary-user';
    keycloakService.exchangeCodeForTokens.mockResolvedValue({
      access_token: 'access-token',
    });
    keycloakService.getUserInfo.mockResolvedValue({
      sub: 'secondary-user',
      email: 'secondary@example.com',
    });
    userService.findByKeycloakId.mockResolvedValue({
      id: 'local-secondary-user',
      email: 'secondary@example.com',
      keycloakId: 'secondary-user',
      isOnboarded: true,
    });
    userService.updateFromKeycloakOAuth.mockResolvedValue({
      id: 'local-secondary-user',
      email: 'secondary@example.com',
      keycloakId: 'secondary-user',
      isOnboarded: true,
    });
    const { res, redirect } = createRedirectResponse();

    await controller.googleCallback('code-1', 'state-1', '', session, res);

    expect(accountLinkingService.createMergeRequest).not.toHaveBeenCalled();
    expect(redirect).toHaveBeenCalledWith(
      'http://localhost:4200/settings/linked-accounts/google?accountLink=already-linked',
    );
  });

  it('confirms and cancels merge requests through the account-linking service', async () => {
    accountLinkingService.confirmMerge.mockResolvedValue({
      primaryUserId: 'primary-user',
      mergedUserId: 'secondary-user',
    });

    await expect(
      controller.confirmMerge(
        'merge-request-1',
        { primaryEmail: 'primary@example.com' },
        session,
      ),
    ).resolves.toEqual({
      primaryUserId: 'primary-user',
      mergedUserId: 'secondary-user',
    });
    await expect(
      controller.cancelMerge('merge-request-1', session),
    ).resolves.toEqual({ success: true });

    expect(accountLinkingService.confirmMerge).toHaveBeenCalledWith(
      'merge-request-1',
      'secondary-user',
      'primary@example.com',
    );
    expect(accountLinkingService.cancelRequest).toHaveBeenCalledWith(
      'merge-request-1',
      'secondary-user',
    );
  });

  it('leaves the session unchanged when a completed merge primary user cannot be loaded', async () => {
    accountLinkingService.getRequest.mockResolvedValue(createMergeRequest());
    userService.findByKeycloakId.mockResolvedValue(null);

    await expect(
      controller.getMergeRequest('merge-request-1', session),
    ).resolves.toEqual(createMergeRequest());

    expect(session.user?.keycloakId).toBe('secondary-user');
  });

  it('covers private URL and comparison edge cases used by account-linking redirects', async () => {
    const internals = controller as unknown as {
      secureCompare: (a: string, b: string) => boolean;
      googleIntegrationUrl: () => string;
      switchSessionToUser: (
        session: AuthSession,
        keycloakId: string,
      ) => Promise<void>;
    };
    const emptySession = {
      destroy: jest.fn(),
    } as AuthSession;
    userService.findByKeycloakId.mockResolvedValue({
      id: 'local-primary-user',
      email: 'primary@example.com',
      keycloakId: 'primary-user',
      isOnboarded: true,
    });

    await internals.switchSessionToUser(emptySession, 'primary-user');

    expect(internals.googleIntegrationUrl()).toBe(
      'http://localhost:4200/settings/linked-accounts/google',
    );
    expect(
      internals.secureCompare(Symbol('bad') as unknown as string, 'state-1'),
    ).toBe(false);
  });
});
