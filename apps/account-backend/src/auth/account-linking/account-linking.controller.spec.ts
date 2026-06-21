import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { NextFunction, Request, Response } from 'express';
import * as request from 'supertest';
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
};

type UserServiceMock = {
  findByKeycloakId: jest.Mock;
};

type AccountLinkingServiceMock = {
  getRequest: jest.Mock;
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

describe('AccountLinkingController', () => {
  let app: INestApplication<App> | undefined;
  let session: AuthSession;
  let keycloakService: KeycloakServiceMock;
  let userService: UserServiceMock;
  let accountLinkingService: AccountLinkingServiceMock;

  beforeEach(async () => {
    session = createSession();

    keycloakService = {
      getUserBasicInfo: jest.fn(),
    };
    userService = {
      findByKeycloakId: jest.fn(),
    };
    accountLinkingService = {
      getRequest: jest.fn(),
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
});
