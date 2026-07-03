import {
  AccountManagerKeycloakRole,
  AccountManagerPermission,
} from '@cacic/shared-types';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthSession } from '../auth.controller';
import { AccountPermissionService } from '../services/account-permission.service';
import { KeycloakService } from '../services/keycloak.service';
import { KeycloakRoleConfig, KeycloakRoleGuard } from './keycloak-role.guard';

type KeycloakMock = {
  getUserRoles: jest.Mock<
    ReturnType<KeycloakService['getUserRoles']>,
    Parameters<KeycloakService['getUserRoles']>
  >;
};

type AccountPermissionMock = {
  hasAnyActivePermission: jest.Mock<
    ReturnType<AccountPermissionService['hasAnyActivePermission']>,
    Parameters<AccountPermissionService['hasAnyActivePermission']>
  >;
};

type ReflectorMock = {
  getAllAndOverride: jest.Mock<KeycloakRoleConfig, unknown[]>;
};

const createExecutionContext = (userId = 'user-1'): ExecutionContext => {
  const request = {
    session: {
      user: {
        id: 'account-user-1',
        email: 'alice@example.com',
        keycloakId: userId,
        isOnboarded: true,
      },
      destroy: (callback: (err?: Error) => void) => callback(),
    } satisfies AuthSession,
  };

  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
    getHandler: () => createExecutionContext,
    getClass: () => KeycloakRoleGuard,
  } as unknown as ExecutionContext;
};

const createContext = (
  config: KeycloakRoleConfig = {
    roles: [AccountManagerKeycloakRole.PermissionGrantRead],
  },
) => {
  const keycloakService: KeycloakMock = {
    getUserRoles: jest.fn<
      ReturnType<KeycloakService['getUserRoles']>,
      Parameters<KeycloakService['getUserRoles']>
    >(),
  };
  keycloakService.getUserRoles.mockResolvedValue([]);

  const accountPermissionService: AccountPermissionMock = {
    hasAnyActivePermission: jest.fn<
      ReturnType<AccountPermissionService['hasAnyActivePermission']>,
      Parameters<AccountPermissionService['hasAnyActivePermission']>
    >(),
  };
  accountPermissionService.hasAnyActivePermission.mockResolvedValue(false);

  const reflector: ReflectorMock = {
    getAllAndOverride: jest.fn<KeycloakRoleConfig, unknown[]>(),
  };
  reflector.getAllAndOverride.mockReturnValue(config);

  const guard = new KeycloakRoleGuard(
    keycloakService as unknown as KeycloakService,
    accountPermissionService as unknown as AccountPermissionService,
    reflector as unknown as Reflector,
  );

  return {
    accountPermissionService,
    guard,
    keycloakService,
  };
};

describe('KeycloakRoleGuard', () => {
  it('keeps the Keycloak role success path intact', async () => {
    const { accountPermissionService, guard, keycloakService } =
      createContext();
    keycloakService.getUserRoles.mockResolvedValue([
      AccountManagerKeycloakRole.PermissionGrantRead,
    ]);

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(
      true,
    );

    expect(
      accountPermissionService.hasAnyActivePermission,
    ).not.toHaveBeenCalled();
  });

  it('checks database-backed permissions after Keycloak role lookup fails', async () => {
    const { accountPermissionService, guard, keycloakService } =
      createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));
    accountPermissionService.hasAnyActivePermission.mockImplementation(
      (_userId, permissions) =>
        Promise.resolve(
          permissions.includes(AccountManagerPermission.PermissionGrantRead),
        ),
    );

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(
      true,
    );

    expect(
      accountPermissionService.hasAnyActivePermission,
    ).toHaveBeenCalledWith('user-1', [AccountManagerKeycloakRole.SuperAdmin]);
    expect(
      accountPermissionService.hasAnyActivePermission,
    ).toHaveBeenCalledWith('user-1', [
      AccountManagerPermission.PermissionGrantRead,
    ]);
  });

  it('throws only after Keycloak and database-backed checks both fail', async () => {
    const { accountPermissionService, guard, keycloakService } =
      createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));

    await expect(
      guard.canActivate(createExecutionContext()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(accountPermissionService.hasAnyActivePermission).toHaveBeenCalled();
  });
});
