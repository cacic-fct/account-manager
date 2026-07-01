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
    OR?: DirectGrantSourceFilter[];
  };
};

type DirectGrantSourceFilter =
  | { studentEntityMembershipId: null }
  | {
      studentEntityMembership: {
        is: {
          deletedAt: null;
          mandateStart: { lte: Date };
          OR: [{ mandateEnd: null }, { mandateEnd: { gt: Date } }];
        };
      };
    };

const expectDirectOrLegacyMembershipGrantFilter = (
  filters: DirectGrantSourceFilter[] | undefined,
): void => {
  expect(filters?.[0]).toEqual({ studentEntityMembershipId: null });
  const legacyMembershipFilter = filters?.[1];
  if (
    !legacyMembershipFilter ||
    !('studentEntityMembership' in legacyMembershipFilter)
  ) {
    throw new Error('Expected legacy membership grant filter.');
  }

  expect(
    legacyMembershipFilter.studentEntityMembership.is.deletedAt,
  ).toBeNull();
  expect(
    legacyMembershipFilter.studentEntityMembership.is.mandateStart.lte,
  ).toBeInstanceOf(Date);
  expect(legacyMembershipFilter.studentEntityMembership.is.OR[0]).toEqual({
    mandateEnd: null,
  });
  expect(
    legacyMembershipFilter.studentEntityMembership.is.OR[1].mandateEnd.gt,
  ).toBeInstanceOf(Date);
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
    expectDirectOrLegacyMembershipGrantFilter(findFirstArgs.where.OR);
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

  it('filters legacy membership entities out of group grant lookups', async () => {
    const { prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: 'LEGACY_GROUP' },
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

    const groupGrantArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakGroupPermissionGrant.findFirst,
    );
    expect(groupGrantArgs.where.groupKey).toEqual({
      in: [PermissionGroupKey.Cacic],
    });
  });

  it('preserves active legacy membership-linked grants during permission checks', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'legacy-grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [
        AccountManagerPermission.PermissionGrantRead,
      ]),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expectDirectOrLegacyMembershipGrantFilter(findFirstArgs.where.OR);
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

  it('skips legacy memberships with unknown group keys during Keycloak group permission checks', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: 'LEGACY_GROUP' },
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

  it('treats failed Keycloak group permission probes as misses', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: PermissionGroupKey.Cacic },
    ]);
    keycloakService.getGroupClientRoles.mockRejectedValue(
      new Error('Keycloak down'),
    );

    await expect(
      service.hasAnyActivePermission('user-1', [
        AccountManagerPermission.StudentVerificationReview,
      ]),
    ).resolves.toBe(false);
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
