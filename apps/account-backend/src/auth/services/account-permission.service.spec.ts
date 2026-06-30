import {
  AccountManagerPermission,
  PermissionGroupKey,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakService } from './keycloak.service';
import { AccountPermissionService } from './account-permission.service';

type PrismaMock = {
  keycloakPermissionGrant: {
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
  };
  keycloakGroupPermissionGrant: {
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
  };
  studentEntityMembership: {
    findMany: jest.Mock<Promise<{ entity: string }[]>, [unknown]>;
  };
};

type KeycloakMock = {
  getUserRoles: jest.Mock<
    ReturnType<KeycloakService['getUserRoles']>,
    Parameters<KeycloakService['getUserRoles']>
  >;
  getGroupClientRoles: jest.Mock<
    ReturnType<KeycloakService['getGroupClientRoles']>,
    Parameters<KeycloakService['getGroupClientRoles']>
  >;
};

type PermissionFindFirstArgs = {
  where: {
    userId?: string;
    groupKey?: { in: string[] };
    permission: { in: string[] };
    deletedAt: null;
    studentEntityMembershipId?: null;
  };
};

const getMockArg = <T>(
  mock: { mock: { calls: [unknown][] } },
  callIndex = 0,
): T => {
  const call = mock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`Expected mock call ${callIndex} to exist.`);
  }

  return call[0] as T;
};

const createContext = () => {
  const prisma: PrismaMock = {
    keycloakPermissionGrant: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
    },
    keycloakGroupPermissionGrant: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
    },
    studentEntityMembership: {
      findMany: jest.fn<Promise<{ entity: string }[]>, [unknown]>(),
    },
  };

  prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.keycloakGroupPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.studentEntityMembership.findMany.mockResolvedValue([]);

  const keycloakService: KeycloakMock = {
    getUserRoles: jest.fn<
      ReturnType<KeycloakService['getUserRoles']>,
      Parameters<KeycloakService['getUserRoles']>
    >(),
    getGroupClientRoles: jest.fn<
      ReturnType<KeycloakService['getGroupClientRoles']>,
      Parameters<KeycloakService['getGroupClientRoles']>
    >(),
  };
  keycloakService.getUserRoles.mockResolvedValue([]);
  keycloakService.getGroupClientRoles.mockResolvedValue([]);

  const service = new AccountPermissionService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
  );

  return {
    keycloakService,
    prisma,
    service,
  };
};

describe('AccountPermissionService', () => {
  it('checks active direct grants with super-admin inheritance', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [
        AccountManagerPermission.PermissionGrantRead,
      ]),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.userId).toBe('user-1');
    expect(findFirstArgs.where.deletedAt).toBeNull();
    expect(findFirstArgs.where.studentEntityMembershipId).toBeNull();
    expect(findFirstArgs.where.permission.in).toEqual([
      AccountManagerPermission.PermissionGrantRead,
      AccountManagerPermission.SuperAdmin,
    ]);
    expect(prisma.studentEntityMembership.findMany).not.toHaveBeenCalled();
  });

  it('resolves active permission through a group grant', async () => {
    const { prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: PermissionGroupKey.Cacic },
    ]);
    prisma.keycloakGroupPermissionGrant.findFirst.mockResolvedValue({
      id: 'group-grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [
        AccountManagerPermission.StudentVerificationReview,
      ]),
    ).resolves.toBe(true);

    const membershipArgs = getMockArg<{
      where: { userId: string; deletedAt: null };
      select: { entity: true };
    }>(prisma.studentEntityMembership.findMany);
    const groupGrantArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakGroupPermissionGrant.findFirst,
    );
    expect(membershipArgs.where.userId).toBe('user-1');
    expect(groupGrantArgs.where.groupKey).toEqual({
      in: [PermissionGroupKey.Cacic],
    });
    expect(groupGrantArgs.where.permission.in).toEqual([
      AccountManagerPermission.StudentVerificationReview,
      AccountManagerPermission.SuperAdmin,
    ]);
  });

  it('resolves active permission through a Keycloak-only group role mapping', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: PermissionGroupKey.Cacic },
    ]);
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        Promise.resolve(
          clientId === 'cacic-account-manager'
            ? ['student-verification#review']
            : [],
        ),
    );

    await expect(
      service.hasAnyActivePermission('user-1', [
        AccountManagerPermission.StudentVerificationReview,
      ]),
    ).resolves.toBe(true);

    expect(keycloakService.getGroupClientRoles).toHaveBeenCalledWith(
      '5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
      'cacic-account-manager',
    );
  });

  it('treats a super-admin grant as all account-manager admin permissions', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;
        return Promise.resolve(
          permissions.includes(AccountManagerPermission.SuperAdmin)
            ? { id: 'grant-super-admin' }
            : null,
        );
      },
    );

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(true);
    await expect(
      service.hasAllActivePermissions('user-1', [
        AccountManagerPermission.DiscordManagementUpdate,
        AccountManagerPermission.AccountDeletionUpdate,
      ]),
    ).resolves.toBe(true);
  });

  it('treats a Keycloak super-admin role as Discord admin access', async () => {
    const { keycloakService, service } = createContext();
    keycloakService.getUserRoles.mockResolvedValue(['super-admin']);

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(true);
  });

  it('falls back to database permissions when Keycloak bootstrap role lookup fails', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;
        return Promise.resolve(
          permissions.includes(AccountManagerPermission.DiscordManagementRead)
            ? { id: 'grant-1' }
            : null,
        );
      },
    );

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(true);
  });

  it('requires assign permission before assigning any grant', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);

    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.DiscordManagementRead,
      ),
    ).resolves.toBe(false);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.permission.in).toContain(
      AccountManagerPermission.PermissionGrantAssign,
    );
  });

  it('allows Keycloak super-admins to seed account-manager grants', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockResolvedValue(['super-admin']);

    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.PermissionGrantAssign,
      ),
    ).resolves.toBe(true);
    await expect(
      service.canRevokePermission(
        'actor-1',
        AccountManagerPermission.PermissionGrantRevoke,
      ),
    ).resolves.toBe(true);
    expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
  });

  it('continues through assign permission checks when Keycloak bootstrap role lookup fails', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;
        return Promise.resolve(
          permissions.includes(
            AccountManagerPermission.PermissionGrantAssign,
          ) ||
            permissions.includes(AccountManagerPermission.DiscordManagementRead)
            ? { id: 'grant-1' }
            : null,
        );
      },
    );

    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.DiscordManagementRead,
      ),
    ).resolves.toBe(true);
  });

  it('requires revoke permission before revoking any grant', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);

    await expect(
      service.canRevokePermission(
        'actor-1',
        AccountManagerPermission.DiscordManagementRead,
      ),
    ).resolves.toBe(false);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.permission.in).toContain(
      AccountManagerPermission.PermissionGrantRevoke,
    );
  });

  it('allows client super-admins with assign permission to assign any role for that client', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;
        if (
          permissions.includes(
            AccountManagerPermission.PermissionGrantAssign,
          ) ||
          permissions.includes(AccountManagerPermission.SuperAdmin)
        ) {
          return Promise.resolve({ id: 'grant-1' });
        }

        return Promise.resolve(null);
      },
    );

    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.AccountDeletionUpdate,
      ),
    ).resolves.toBe(true);
  });

  it('allows non-super-admin assigners to assign only permissions they already hold', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;
        if (
          permissions.includes(
            AccountManagerPermission.PermissionGrantAssign,
          ) ||
          permissions.includes(AccountManagerPermission.DiscordManagementRead)
        ) {
          return Promise.resolve({ id: 'grant-1' });
        }

        return Promise.resolve(null);
      },
    );

    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.DiscordManagementRead,
      ),
    ).resolves.toBe(true);
    await expect(
      service.canAssignPermission(
        'actor-1',
        AccountManagerPermission.AccountDeletionUpdate,
      ),
    ).resolves.toBe(false);
  });
});
