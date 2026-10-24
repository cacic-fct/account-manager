import { ACCOUNT_MANAGER_ADMIN_PERMISSIONS } from '@cacic/shared-types';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountPermissionService } from '../services/account-permission.service';
import { KeycloakService } from '../services/keycloak.service';
import { AccountPermissionGuard } from './account-permission.guard';
import { CurrentUserGuard } from './current-user.guard';

describe(AccountPermissionGuard.name, () => {
  const permissions = {
    hasAnyActivePermission: jest.fn().mockResolvedValue(true),
    hasAllActivePermissions: jest.fn().mockResolvedValue(true),
    hasAccountManagerSuperAdminAccess: jest.fn().mockResolvedValue(false),
  };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue({ permissions: ['account#read'], mode: 'any' }),
  };
  const currentUser = {
    canActivate: jest.fn().mockResolvedValue(true),
  };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({
        session: { user: { keycloakId: 'user-1' } },
      }),
    }),
  } as unknown as ExecutionContext;

  beforeEach(() => jest.clearAllMocks());

  it('revalidates the live Keycloak user before consulting permission state', async () => {
    const disabled = new ForbiddenException('Esta conta está desativada.');
    currentUser.canActivate.mockRejectedValueOnce(disabled);
    const guard = new AccountPermissionGuard(
      permissions as unknown as AccountPermissionService,
      reflector as unknown as Reflector,
      currentUser as unknown as CurrentUserGuard,
    );

    await expect(guard.canActivate(context)).rejects.toBe(disabled);
    expect(permissions.hasAnyActivePermission).not.toHaveBeenCalled();
  });

  it.each(['any', 'all'] as const)(
    'authorizes every Account Manager admin operation through super-admin inheritance in %s mode',
    async (mode) => {
      const keycloakService = { getUserRoles: jest.fn().mockResolvedValue(['super-admin']) };
      const prisma = {
        keycloakPermissionGrant: { findFirst: jest.fn() },
        keycloakGroupPermissionGrant: { findFirst: jest.fn() },
      };
      const permissionService = new AccountPermissionService(
        prisma as unknown as PrismaService,
        keycloakService as unknown as KeycloakService,
      );
      const permissionReflector = { getAllAndOverride: jest.fn() };
      const guard = new AccountPermissionGuard(
        permissionService,
        permissionReflector as unknown as Reflector,
        currentUser as unknown as CurrentUserGuard,
      );

      for (const permission of ACCOUNT_MANAGER_ADMIN_PERMISSIONS) {
        permissionReflector.getAllAndOverride.mockReturnValue({ permissions: [permission], mode });
        await expect(guard.canActivate(context)).resolves.toBe(true);
      }
      permissionReflector.getAllAndOverride.mockReturnValue({ permissions: ACCOUNT_MANAGER_ADMIN_PERMISSIONS, mode });
      await expect(guard.canActivate(context)).resolves.toBe(true);

      expect(currentUser.canActivate).toHaveBeenCalledTimes(ACCOUNT_MANAGER_ADMIN_PERMISSIONS.length + 1);
      expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
      expect(prisma.keycloakGroupPermissionGrant.findFirst).not.toHaveBeenCalled();
    },
  );
});
