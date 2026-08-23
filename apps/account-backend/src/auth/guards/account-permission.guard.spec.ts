import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AccountPermissionService } from '../services/account-permission.service';
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
    const disabled = new ForbiddenException('Session user is disabled');
    currentUser.canActivate.mockRejectedValueOnce(disabled);
    const guard = new AccountPermissionGuard(
      permissions as unknown as AccountPermissionService,
      reflector as unknown as Reflector,
      currentUser as unknown as CurrentUserGuard,
    );

    await expect(guard.canActivate(context)).rejects.toBe(disabled);
    expect(permissions.hasAnyActivePermission).not.toHaveBeenCalled();
  });
});
