import { ConfigService } from '@nestjs/config';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import * as jwt from 'jsonwebtoken';
import session from 'express-session';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthController } from '../src/auth/auth.controller';
import { CsrfService } from '../src/auth/csrf/csrf.service';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { JwtPayload, JwtService } from '../src/auth/jwt/jwt.service';
import { AccountPermissionService } from '../src/auth/services/account-permission.service';
import { KeycloakService } from '../src/auth/services/keycloak.service';
import { UserService } from '../src/auth/services/user.service';
import type { KeycloakUser } from '../src/auth/interfaces/auth.interface';
import { TotpService } from '../src/totp/totp.service';
import { API_GLOBAL_PREFIX } from '../src/config/app.config';
import { createAuthTestConfigService, createUserServiceFake, waitForKeycloakRealm } from './auth-test-helpers';

const keycloakUrl = process.env.KEYCLOAK_URL ?? 'http://localhost:18080';

describe('Keycloak authentication (e2e)', () => {
  let app: INestApplication<App>;
  let previousEnv: NodeJS.ProcessEnv;

  beforeAll(async () => {
    previousEnv = { ...process.env };
    Object.assign(process.env, {
      NODE_ENV: 'test',
      KEYCLOAK_URL: keycloakUrl,
      KEYCLOAK_REALM: 'cacic-sso',
      KEYCLOAK_CLIENT_ID: 'cacic-account-manager',
      KEYCLOAK_CLIENT_SECRET: 'cacic-account-manager-dev-secret',
      KEYCLOAK_ADMIN_CLIENT_ID: 'cacic-account-manager-admin-client',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'cacic-account-manager-admin-client-dev-secret',
      KEYCLOAK_M2M_AUDIENCE: 'cacic-account-manager-audience',
      KEYCLOAK_M2M_ALLOWED_CLIENTS: 'cacic-event-manager-m2m',
      KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT: 'true',
    });

    await waitForKeycloakRealm(keycloakUrl);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        KeycloakService,
        JwtService,
        AuthGuard,
        CsrfService,
        {
          provide: ConfigService,
          useValue: createAuthTestConfigService({
            KEYCLOAK_URL: keycloakUrl,
            KEYCLOAK_REALM: 'cacic-sso',
            KEYCLOAK_M2M_AUDIENCE: 'cacic-account-manager-audience',
            KEYCLOAK_M2M_ALLOWED_CLIENTS: 'cacic-event-manager-m2m',
            KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT: 'true',
          }),
        },
        {
          provide: UserService,
          useValue: createUserServiceFake(),
        },
        {
          provide: AccountPermissionService,
          useValue: {
            hasAccountManagerSuperAdminAccess: jest.fn().mockResolvedValue(false),
            hasAccountManagerAdminAccess: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: TotpService,
          useValue: {
            getOrCreateSeed: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useClass(AuthGuard)
      .compile();

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
    if (app) {
      await app.close();
    }
    process.env = previousEnv;
  });

  it('redirects OAuth login to the fresh test Keycloak realm with PKCE and no dev IdP hint', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/auth/login/redirect')
      .query({
        returnTo: '/settings',
        prompt: 'none',
      })
      .expect(302);

    const location = new URL(response.headers.location);
    expect(location.origin).toBe(keycloakUrl);
    expect(location.pathname).toBe('/realms/cacic-sso/protocol/openid-connect/auth');
    expect(location.searchParams.get('client_id')).toBe('cacic-account-manager');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost:3000/api/auth/callback');
    expect(location.searchParams.get('prompt')).toBe('none');
    expect(location.searchParams.get('code_challenge')).toBeTruthy();
    expect(location.searchParams.get('code_challenge_method')).toBe('S256');
    expect(location.searchParams.has('kc_idp_hint')).toBe(false);
  });

  it('logs in an onboarded imported Keycloak user and persists the session', async () => {
    const agent = request.agent(app.getHttpServer());

    const loginResponse = await agent
      .post('/api/auth/password-login')
      .send({
        email: 'ALUNO@UNESP.BR',
        password: '1',
        returnTo: '/settings',
      })
      .expect(200);

    expect(loginResponse.body).toEqual({
      success: true,
      isAuthenticated: true,
      isOnboarded: true,
      redirectUrl: 'http://localhost:4200/app/settings',
    });
    expect(loginResponse.headers['set-cookie']).toEqual(
      expect.arrayContaining([expect.stringContaining('connect.sid')]),
    );

    await agent.get('/api/auth/check').expect(200).expect({
      isAuthenticated: true,
      isOnboarded: true,
    });
  });

  it('reads default imported userinfo claims from real Keycloak direct grants', async () => {
    const keycloakService = app.get(KeycloakService);
    const tokens = await keycloakService.exchangePasswordForTokens('aluno@unesp.br', '1');
    const userInfo = await keycloakService.getUserInfo(tokens.access_token);

    expect(userInfo).toEqual(
      expect.objectContaining({
        sub: '22222222-2222-2222-2222-222222222222',
        email: 'aluno@unesp.br',
        email_verified: true,
        name: 'Aluno Unesp',
      }),
    );
    expect((userInfo as KeycloakUser & { is_onboarded?: string }).is_onboarded).toBe('true');
  });

  it('keeps non-onboarded imported Keycloak users on onboarding', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/auth/password-login')
      .send({
        email: 'externo@gmail.com',
        password: '1',
        returnTo: '/settings',
      })
      .expect(200);

    expect(response.body).toEqual({
      success: true,
      isAuthenticated: true,
      isOnboarded: false,
      redirectUrl: 'http://localhost:4200/app/onboarding',
    });
  });

  it('rejects invalid password credentials from the test realm', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/password-login')
      .send({
        email: 'aluno@unesp.br',
        password: 'wrong-password',
      })
      .expect(401);
  });

  it('validates imported M2M audience roles from a real Keycloak token', async () => {
    const jwtService = app.get(JwtService);
    const token = await jwtService.getClientCredentialsToken({
      clientId: 'cacic-event-manager-m2m',
      clientSecret: 'cacic-event-manager-m2m-dev-secret',
    });
    const payload = jwt.decode(token) as JwtPayload | null;

    if (!payload) {
      throw new Error('Expected Keycloak to return a decodable JWT.');
    }

    const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];

    expect(audiences).toContain('cacic-account-manager-audience');
    expect(jwtService.isAllowedM2MClient(payload)).toBe(true);
    expect(jwtService.isServiceAccountToken(payload)).toBe(true);
    expect(jwtService.hasRequiredRole(payload, 'privacy:read')).toBe(true);
    expect(jwtService.hasRequiredRole(payload, 'privacy:write')).toBe(true);
    expect(jwtService.hasRequiredRole(payload, 'lgpd:read')).toBe(false);
  });
});
