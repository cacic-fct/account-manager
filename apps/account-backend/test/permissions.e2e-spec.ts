import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import {
  AccountManagerPermission,
  PermissionGroupKey,
  type PermissionSelfServiceAccess,
} from '@cacic/shared-types';
import { AuthGuard } from '../src/auth/guards/auth.guard';
import { AccountPermissionGuard } from '../src/auth/guards/account-permission.guard';
import { CsrfGuard } from '../src/auth/csrf/csrf.guard';
import { API_GLOBAL_PREFIX } from '../src/config/app.config';
import {
  KeycloakPermissionsController,
  UserPermissionsController,
} from '../src/keycloak-permissions/keycloak-permissions.controller';
import { KeycloakPermissionsService } from '../src/keycloak-permissions/keycloak-permissions.service';

const sessionUser = {
  keycloakId: 'user-1',
  email: 'alice@example.com',
};

const attachSession = (context: {
  switchToHttp: () => { getRequest: () => { session?: unknown } };
}) => {
  const request = context.switchToHttp().getRequest();
  request.session = {
    user: sessionUser,
    csrfToken: 'test-csrf-token',
  };
};

describe('Permissions controllers (e2e)', () => {
  let app: INestApplication<App>;
  let keycloakPermissions: {
    getSelfServiceAccess: jest.Mock;
    selfRemoveGrant: jest.Mock;
    selfRemoveMembership: jest.Mock;
    updatePermissionGroupRoleGrants: jest.Mock;
  };

  beforeAll(async () => {
    keycloakPermissions = {
      getSelfServiceAccess: jest.fn().mockResolvedValue({
        memberships: [
          {
            id: 'membership-1',
            groupKey: PermissionGroupKey.Cacic,
            keycloakGroupId: '5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
            keycloakGroupPath: '/Entidades estudantis/CACiC',
            discordRoleId: '533900085642133504',
            userId: 'user-1',
            userEmail: 'alice@example.com',
            userDisplayName: 'Alice Example',
            validFrom: '2026-01-01T00:00:00.000Z',
            validUntil: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
        grants: [
          {
            id: 'grant-1',
            userId: 'user-1',
            userEmail: 'alice@example.com',
            userDisplayName: 'Alice Example',
            clientId: 'cacic-account-manager',
            roleName: 'permission-grant#read',
            permission: AccountManagerPermission.PermissionGrantRead,
            source: 'direct',
            validFrom: null,
            validUntil: null,
            status: 'active',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
      selfRemoveGrant: jest.fn().mockResolvedValue({
        removed: true,
        id: 'grant-1',
      }),
      selfRemoveMembership: jest.fn().mockResolvedValue({
        removed: true,
        id: 'membership-1',
      }),
      updatePermissionGroupRoleGrants: jest.fn().mockResolvedValue([
        {
          id: 'group-grant-1',
          groupKey: PermissionGroupKey.Cacic,
          clientId: 'cacic-account-manager',
          roleName: 'permission-grant#read',
          permission: AccountManagerPermission.PermissionGrantRead,
          source: 'database',
          validFrom: null,
          validUntil: null,
          status: 'active',
        },
      ]),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [KeycloakPermissionsController, UserPermissionsController],
      providers: [
        {
          provide: KeycloakPermissionsService,
          useValue: keycloakPermissions,
        },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: Parameters<typeof attachSession>[0]) => {
          attachSession(context);
          return true;
        },
      })
      .overrideGuard(AccountPermissionGuard)
      .useValue({
        canActivate: (context: Parameters<typeof attachSession>[0]) => {
          attachSession(context);
          return true;
        },
      })
      .overrideGuard(CsrfGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_GLOBAL_PREFIX);
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

  it('returns current user group memberships and direct grants', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/permissions/me')
      .expect(200);
    const body = response.body as PermissionSelfServiceAccess;

    expect(body.memberships).toHaveLength(1);
    expect(body.grants).toHaveLength(1);
    expect(keycloakPermissions.getSelfServiceAccess).toHaveBeenCalledWith(
      'user-1',
    );
  });

  it('lets users remove their own direct grants', async () => {
    await request(app.getHttpServer())
      .delete('/api/permissions/me/grants/grant-1')
      .expect(200)
      .expect({
        removed: true,
        id: 'grant-1',
      });

    expect(keycloakPermissions.selfRemoveGrant).toHaveBeenCalledWith(
      'user-1',
      'grant-1',
    );
  });

  it('passes admin group role updates with the session actor id', async () => {
    await request(app.getHttpServer())
      .put('/api/admin/permissions/groups/CACIC/role-grants')
      .send({
        permissions: [AccountManagerPermission.PermissionGrantRead],
      })
      .expect(200);

    expect(
      keycloakPermissions.updatePermissionGroupRoleGrants,
    ).toHaveBeenCalledWith(
      PermissionGroupKey.Cacic,
      { permissions: [AccountManagerPermission.PermissionGrantRead] },
      'user-1',
    );
  });
});
