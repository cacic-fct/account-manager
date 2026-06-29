import {
  AccountManagerPermission,
  PermissionGroupKey,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
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

type PermissionFindFirstArgs = {
  where: {
    userId?: string;
    groupKey?: { in: string[] };
    permission: { in: string[] };
    deletedAt: null;
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

  const service = new AccountPermissionService(
    prisma as unknown as PrismaService,
  );

  return {
    prisma,
    service,
  };
};

describe('AccountPermissionService', () => {
  it('rejects empty permission checks without querying grants', async () => {
    const { prisma, service } = createContext();

    await expect(service.hasAnyActivePermission('user-1', [])).resolves.toBe(
      false,
    );
    await expect(service.hasAllActivePermissions('user-1', [])).resolves.toBe(
      false,
    );

    expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.keycloakGroupPermissionGrant.findFirst,
    ).not.toHaveBeenCalled();
  });

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
    await expect(service.hasAccountManagerAdminAccess('user-1')).resolves.toBe(
      true,
    );
    await expect(
      service.hasAllActivePermissions('user-1', [
        AccountManagerPermission.DiscordManagementUpdate,
        AccountManagerPermission.AccountDeletionUpdate,
      ]),
    ).resolves.toBe(true);
  });

  it('requires every requested permission when no super-admin grant exists', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;

        return Promise.resolve(
          permissions.includes(
            AccountManagerPermission.DiscordManagementRead,
          ) ||
            permissions.includes(AccountManagerPermission.AccountDeletionRead)
            ? { id: 'grant-1' }
            : null,
        );
      },
    );

    await expect(
      service.hasAllActivePermissions('user-1', [
        AccountManagerPermission.DiscordManagementRead,
        AccountManagerPermission.AccountDeletionRead,
      ]),
    ).resolves.toBe(true);
    await expect(
      service.hasAllActivePermissions('user-1', [
        AccountManagerPermission.DiscordManagementRead,
        AccountManagerPermission.AccountDeletionUpdate,
      ]),
    ).resolves.toBe(false);
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

  it('rejects invalid permission ids even when the actor can assign grants', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation(
      (args: unknown) => {
        const permissions = (args as PermissionFindFirstArgs).where.permission
          .in;

        return Promise.resolve(
          permissions.includes(AccountManagerPermission.PermissionGrantAssign)
            ? { id: 'grant-assign' }
            : null,
        );
      },
    );

    await expect(
      service.canAssignPermission('actor-1', 'not-a-keycloak-permission'),
    ).resolves.toBe(false);
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

  it('returns false when the low-level permission helper receives no permissions', async () => {
    const { prisma, service } = createContext();
    const internals = service as unknown as {
      hasAnyDirectOrGroupPermission: (
        userId: string,
        permissions: readonly string[],
        now: Date,
      ) => Promise<boolean>;
    };

    await expect(
      internals.hasAnyDirectOrGroupPermission('user-1', [], new Date()),
    ).resolves.toBe(false);

    expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.keycloakGroupPermissionGrant.findFirst,
    ).not.toHaveBeenCalled();
  });
});
