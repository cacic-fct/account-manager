import { ConfigService } from '@nestjs/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import session from 'express-session';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from '../src/auth/auth.controller';
import { CsrfService } from '../src/auth/csrf/csrf.service';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { AccountPermissionService } from '../src/auth/services/account-permission.service';
import { KeycloakService } from '../src/auth/services/keycloak.service';
import { UserService } from '../src/auth/services/user.service';
import { API_GLOBAL_PREFIX } from '../src/config/app.config';
import {
  createAuthTestConfigService,
  createKeycloakUser,
  createUserServiceFake,
} from './auth-test-helpers';

describe('Authentication (fast e2e)', () => {
  let app: INestApplication<App>;
  let keycloakService: {
    getAuthUrl: jest.Mock;
    exchangePasswordForTokens: jest.Mock;
    getUserInfo: jest.Mock;
  };

  beforeAll(async () => {
    keycloakService = {
      getAuthUrl: jest.fn((_redirectUri, state, options) => {
        const url = new URL(
          'http://keycloak.test/realms/cacic-sso/protocol/openid-connect/auth',
        );
        url.searchParams.set('client_id', 'cacic-account-manager');
        url.searchParams.set('state', state);
        url.searchParams.set('code_challenge', options.codeChallenge);
        if (options.prompt) {
          url.searchParams.set('prompt', options.prompt);
        }
        return url.toString();
      }),
      exchangePasswordForTokens: jest.fn(async (email: string) => {
        if (email === 'bad@unesp.br') {
          throw new Error('invalid_grant');
        }

        return {
          access_token: `access-token:${email}`,
          refresh_token: `refresh-token:${email}`,
          id_token: `id-token:${email}`,
          refresh_expires_in: 3600,
        };
      }),
      getUserInfo: jest.fn(async (token: string) => {
        const email = token.replace('access-token:', '');
        if (email === 'externo@gmail.com') {
          return createKeycloakUser({
            sub: '44444444-4444-4444-4444-444444444444',
            email,
            name: 'Usuario Externo',
          });
        }

        return createKeycloakUser({
          sub: '22222222-2222-2222-2222-222222222222',
          email: 'aluno@unesp.br',
          name: 'Aluno Unesp',
        });
      }),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthGuard,
        CsrfService,
        {
          provide: ConfigService,
          useValue: createAuthTestConfigService(),
        },
        {
          provide: KeycloakService,
          useValue: keycloakService,
        },
        {
          provide: UserService,
          useValue: createUserServiceFake(),
        },
        {
          provide: AccountPermissionService,
          useValue: {
            hasAccountManagerSuperAdminGrant: jest
              .fn()
              .mockResolvedValue(false),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
    app.use(
      session({
        secret: 'test-session-secret',
        resave: false,
        saveUninitialized: false,
        cookie: {
          secure: false,
          sameSite: 'lax',
        },
      }),
    );
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('redirects OAuth login with PKCE and safe return URL session state', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/login/redirect')
      .query({
        returnTo: '/settings',
        prompt: 'none',
      })
      .expect(302);

    const location = new URL(response.headers.location);
    expect(location.origin).toBe('http://keycloak.test');
    expect(location.searchParams.get('client_id')).toBe(
      'cacic-account-manager',
    );
    expect(location.searchParams.get('prompt')).toBe('none');
    expect(location.searchParams.get('state')).toBeTruthy();
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
  });

  it('logs in an onboarded user and persists the session', async () => {
    const agent = request.agent(app.getHttpServer());

    await agent
      .post('/api/auth/password-login')
      .send({
        email: 'ALUNO@UNESP.BR',
        password: '1',
        returnTo: '/settings',
      })
      .expect(200)
      .expect({
        success: true,
        isAuthenticated: true,
        isOnboarded: true,
        redirectUrl: 'http://localhost:4200/app/settings',
      });

    expect(keycloakService.exchangePasswordForTokens).toHaveBeenCalledWith(
      'aluno@unesp.br',
      '1',
    );
    await agent.get('/api/auth/check').expect(200).expect({
      isAuthenticated: true,
      isOnboarded: true,
    });
  });

  it('keeps non-onboarded users on onboarding', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/password-login')
      .send({
        email: 'externo@gmail.com',
        password: '1',
        returnTo: '/settings',
      })
      .expect(200)
      .expect({
        success: true,
        isAuthenticated: true,
        isOnboarded: false,
        redirectUrl: 'http://localhost:4200/app/onboarding',
      });
  });

  it('rejects invalid password credentials', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/password-login')
      .send({
        email: 'bad@unesp.br',
        password: 'wrong-password',
      })
      .expect(401);
  });
});
