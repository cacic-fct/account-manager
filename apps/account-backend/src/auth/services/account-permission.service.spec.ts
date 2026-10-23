import { AccountManagerPermission, PermissionGroupKey, buildKeycloakPermissionId } from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakService } from './keycloak.service';
import { AccountPermissionService } from './account-permission.service';

type MembershipMock = {
  entity: string;
  deletedAt?: Date | null;
  mandateStart?: Date;
  mandateEnd?: Date | null;
};

type PrismaMock = {
  keycloakPermissionGrant: {
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
    findMany: jest.Mock<Promise<{ permission: string }[]>, [unknown]>;
  };
  keycloakGroupPermissionGrant: {
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
    findMany: jest.Mock<Promise<{ permission: string }[]>, [unknown]>;
  };
  studentEntityMembership: {
    findMany: jest.Mock<Promise<MembershipMock[]>, [unknown]>;
  };
};

type KeycloakMock = {
  getUserRoles: jest.Mock<ReturnType<KeycloakService['getUserRoles']>, Parameters<KeycloakService['getUserRoles']>>;
  getUserClientRoles: jest.Mock<
    ReturnType<KeycloakService['getUserClientRoles']>,
    Parameters<KeycloakService['getUserClientRoles']>
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

const expectDirectOrLegacyMembershipGrantFilter = (filters: DirectGrantSourceFilter[] | undefined): void => {
  expect(filters?.[0]).toEqual({ studentEntityMembershipId: null });
  const legacyMembershipFilter = filters?.[1];
  if (!legacyMembershipFilter || !('studentEntityMembership' in legacyMembershipFilter)) {
    throw new Error('Expected legacy membership grant filter.');
  }

  expect(legacyMembershipFilter.studentEntityMembership.is.deletedAt).toBeNull();
  expect(legacyMembershipFilter.studentEntityMembership.is.mandateStart.lte).toBeInstanceOf(Date);
  expect(legacyMembershipFilter.studentEntityMembership.is.OR[0]).toEqual({
    mandateEnd: null,
  });
  expect(legacyMembershipFilter.studentEntityMembership.is.OR[1].mandateEnd.gt).toBeInstanceOf(Date);
};

const getMockArg = <T>(mock: { mock: { calls: [unknown][] } }, callIndex = 0): T => {
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
      findMany: jest.fn<Promise<{ permission: string }[]>, [unknown]>().mockResolvedValue([]),
    },
    keycloakGroupPermissionGrant: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
      findMany: jest.fn<Promise<{ permission: string }[]>, [unknown]>().mockResolvedValue([]),
    },
    studentEntityMembership: {
      findMany: jest.fn<Promise<MembershipMock[]>, [unknown]>(),
    },
  };

  prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.keycloakGroupPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.studentEntityMembership.findMany.mockResolvedValue([]);

  const keycloakService: KeycloakMock = {
    getUserRoles: jest.fn<ReturnType<KeycloakService['getUserRoles']>, Parameters<KeycloakService['getUserRoles']>>(),
    getUserClientRoles: jest.fn<
      ReturnType<KeycloakService['getUserClientRoles']>,
      Parameters<KeycloakService['getUserClientRoles']>
    >(),
    getGroupClientRoles: jest.fn<
      ReturnType<KeycloakService['getGroupClientRoles']>,
      Parameters<KeycloakService['getGroupClientRoles']>
    >(),
  };
  keycloakService.getUserRoles.mockResolvedValue([]);
  keycloakService.getUserClientRoles.mockResolvedValue([]);
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
  it('checks active direct grants without adding db-backed super-admin', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakPermissionGrant.findFirst);
    expect(findFirstArgs.where.userId).toBe('user-1');
    expect(findFirstArgs.where.deletedAt).toBeNull();
    expectDirectOrLegacyMembershipGrantFilter(findFirstArgs.where.OR);
    expect(findFirstArgs.where.permission.in).toEqual([AccountManagerPermission.PermissionGrantRead]);
    expect(prisma.studentEntityMembership.findMany).not.toHaveBeenCalled();
  });

  it('resolves active permission through a group grant', async () => {
    const { prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([{ entity: PermissionGroupKey.Cacic }]);
    prisma.keycloakGroupPermissionGrant.findFirst.mockResolvedValue({
      id: 'group-grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.StudentVerificationReview]),
    ).resolves.toBe(true);

    const membershipArgs = getMockArg<{
      where: { userId: string; deletedAt: null };
      select: { entity: true };
    }>(prisma.studentEntityMembership.findMany);
    const groupGrantArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakGroupPermissionGrant.findFirst);
    expect(membershipArgs.where.userId).toBe('user-1');
    expect(groupGrantArgs.where.groupKey).toEqual({
      in: [PermissionGroupKey.Cacic],
    });
    expect(groupGrantArgs.where.permission.in).toEqual([AccountManagerPermission.StudentVerificationReview]);
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
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.StudentVerificationReview]),
    ).resolves.toBe(true);

    const groupGrantArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakGroupPermissionGrant.findFirst);
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
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakPermissionGrant.findFirst);
    expectDirectOrLegacyMembershipGrantFilter(findFirstArgs.where.OR);
  });

  it('resolves active permission through effective inherited Keycloak roles', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([{ entity: PermissionGroupKey.Cacic }]);
    keycloakService.getUserClientRoles.mockResolvedValue(['student-verification#review']);
    keycloakService.getGroupClientRoles.mockImplementation((_groupId, clientId) =>
      Promise.resolve(clientId === 'cacic-account-manager' ? ['student-verification#review'] : []),
    );

    await expect(
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.StudentVerificationReview]),
    ).resolves.toBe(true);

    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('user-1', 'cacic-account-manager');
  });

  it('skips legacy memberships with unknown group keys during Keycloak group permission checks', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: 'LEGACY_GROUP' },
      { entity: PermissionGroupKey.Cacic },
    ]);
    keycloakService.getUserClientRoles.mockResolvedValue(['student-verification#review']);
    keycloakService.getGroupClientRoles.mockImplementation((_groupId, clientId) =>
      Promise.resolve(clientId === 'cacic-account-manager' ? ['student-verification#review'] : []),
    );

    await expect(
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.StudentVerificationReview]),
    ).resolves.toBe(true);

    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('user-1', 'cacic-account-manager');
  });

  it('treats failed Keycloak group permission probes as misses', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.studentEntityMembership.findMany.mockResolvedValue([{ entity: PermissionGroupKey.Cacic }]);
    keycloakService.getGroupClientRoles.mockRejectedValue(new Error('Keycloak down'));

    await expect(
      service.hasAnyActivePermission('user-1', [AccountManagerPermission.StudentVerificationReview]),
    ).resolves.toBe(false);
  });

  it('ignores db-backed super-admin grants for permission inheritance', async () => {
    const { keycloakService, prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      return Promise.resolve(
        permissions.includes(AccountManagerPermission.SuperAdmin) ? { id: 'grant-super-admin' } : null,
      );
    });

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(false);
    await expect(
      service.hasAllActivePermissions('user-1', [
        AccountManagerPermission.DiscordManagementUpdate,
        AccountManagerPermission.AccountDeletionUpdate,
      ]),
    ).resolves.toBe(false);
    expect(keycloakService.getUserRoles).toHaveBeenCalledWith('user-1');
  });

  it('treats a Keycloak super-admin role as Discord admin access', async () => {
    const { keycloakService, service } = createContext();
    keycloakService.getUserRoles.mockResolvedValue(['super-admin']);

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(true);
  });

  it('checks access through Keycloak client roles instead of database grants', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue(['access']);
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'db-access-grant',
    });

    await expect(service.hasAnyActivePermission('user-1', [AccountManagerPermission.Access])).resolves.toBe(true);

    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('user-1', 'cacic-account-manager');
    expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
  });

  it('falls back to database permissions when Keycloak bootstrap role lookup fails', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      return Promise.resolve(
        permissions.includes(AccountManagerPermission.DiscordManagementRead) ? { id: 'grant-1' } : null,
      );
    });

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(true);
  });

  it('requires assign permission before assigning any grant', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);

    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.DiscordManagementRead)).resolves.toBe(
      false,
    );

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakPermissionGrant.findFirst);
    expect(findFirstArgs.where.permission.in).toContain(AccountManagerPermission.PermissionGrantAssign);
  });

  it('requires db-backed assign and revoke permissions before app role changes', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockResolvedValue(['super-admin']);
    keycloakService.getUserClientRoles.mockResolvedValue(['super-admin']);

    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.PermissionGrantAssign)).resolves.toBe(
      false,
    );
    await expect(service.canRevokePermission('actor-1', AccountManagerPermission.PermissionGrantRevoke)).resolves.toBe(
      false,
    );
    expect(prisma.keycloakPermissionGrant.findFirst).toHaveBeenCalled();
  });

  it('allows client super-admins with db-backed assign and revoke permissions to manage access roles for that app', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockImplementation((_userId, clientId) =>
      Promise.resolve(clientId === 'cacic-event-manager' ? ['super-admin'] : []),
    );
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      return Promise.resolve(
        permissions.includes(AccountManagerPermission.PermissionGrantAssign) ||
          permissions.includes(AccountManagerPermission.PermissionGrantRevoke)
          ? { id: 'grant-1' }
          : null,
      );
    });
    const eventAccessPermission = buildKeycloakPermissionId('cacic-event-manager', 'access');
    const eventSuperAdminPermission = buildKeycloakPermissionId('cacic-event-manager', 'super-admin');

    await expect(service.canAssignPermission('actor-1', eventAccessPermission)).resolves.toBe(true);
    await expect(service.canAssignPermission('actor-1', eventSuperAdminPermission)).resolves.toBe(true);
    await expect(service.canRevokePermission('actor-1', eventSuperAdminPermission)).resolves.toBe(true);
    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('actor-1', 'cacic-event-manager');
  });

  it('rejects access role assignment without super-admin for the target app', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue([]);
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      return Promise.resolve(
        permissions.includes(AccountManagerPermission.PermissionGrantAssign) ? { id: 'grant-1' } : null,
      );
    });

    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.Access)).resolves.toBe(false);
    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('actor-1', 'cacic-account-manager');
  });

  it('continues through assign permission checks when Keycloak bootstrap role lookup fails', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserRoles.mockRejectedValue(new Error('Keycloak down'));
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      return Promise.resolve(
        permissions.includes(AccountManagerPermission.PermissionGrantAssign) ||
          permissions.includes(AccountManagerPermission.DiscordManagementRead)
          ? { id: 'grant-1' }
          : null,
      );
    });

    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.DiscordManagementRead)).resolves.toBe(
      true,
    );
  });

  it('requires revoke permission before revoking any grant', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);

    await expect(service.canRevokePermission('actor-1', AccountManagerPermission.DiscordManagementRead)).resolves.toBe(
      false,
    );

    const findFirstArgs = getMockArg<PermissionFindFirstArgs>(prisma.keycloakPermissionGrant.findFirst);
    expect(findFirstArgs.where.permission.in).toContain(AccountManagerPermission.PermissionGrantRevoke);
  });

  it('allows Keycloak client super-admins with assign permission to assign db-managed roles for that client', async () => {
    const { keycloakService, prisma, service } = createContext();
    const eventPermission = buildKeycloakPermissionId('cacic-event-manager', 'events#publish');
    keycloakService.getUserClientRoles.mockImplementation((_userId, clientId) =>
      Promise.resolve(clientId === 'cacic-event-manager' ? ['super-admin'] : []),
    );
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      if (permissions.includes(AccountManagerPermission.PermissionGrantAssign)) {
        return Promise.resolve({ id: 'grant-1' });
      }

      return Promise.resolve(null);
    });

    await expect(service.canAssignPermission('actor-1', eventPermission)).resolves.toBe(true);
    expect(keycloakService.getUserClientRoles).toHaveBeenCalledWith('actor-1', 'cacic-event-manager');
  });

  it('allows non-super-admin assigners to assign only permissions they already hold', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockImplementation((args: unknown) => {
      const permissions = (args as PermissionFindFirstArgs).where.permission.in;
      if (
        permissions.includes(AccountManagerPermission.PermissionGrantAssign) ||
        permissions.includes(AccountManagerPermission.DiscordManagementRead)
      ) {
        return Promise.resolve({ id: 'grant-1' });
      }

      return Promise.resolve(null);
    });

    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.DiscordManagementRead)).resolves.toBe(
      true,
    );
    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.AccountDeletionUpdate)).resolves.toBe(
      false,
    );
  });
  it('recognizes direct or inherited Keycloak permissions without local grants or memberships', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockImplementation((_userId, clientId) =>
      Promise.resolve(
        clientId === 'cacic-account-manager' ? ['permission-grant#read', 'student-verification#review'] : [],
      ),
    );
    await expect(
      service.hasAnyActivePermission('actor-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(true);
    await expect(
      service.hasAllActivePermissions('actor-1', [
        AccountManagerPermission.PermissionGrantRead,
        AccountManagerPermission.StudentVerificationReview,
      ]),
    ).resolves.toBe(true);
    expect(prisma.keycloakPermissionGrant.findFirst).toHaveBeenCalled();
  });

  it('allows delegation from roles assigned directly in Keycloak and detects subsequent removals', async () => {
    const { keycloakService, service } = createContext();
    const permission = 'cacic-event-manager:events#publish';
    let targetRoles = ['events#publish'];
    let accountRoles = ['permission-grant#assign', 'permission-grant#revoke'];
    keycloakService.getUserClientRoles.mockImplementation((_userId, clientId) =>
      Promise.resolve(clientId === 'cacic-account-manager' ? accountRoles : targetRoles),
    );
    await expect(service.canAssignPermission('actor-1', permission)).resolves.toBe(true);
    await expect(service.canRevokePermission('actor-1', permission)).resolves.toBe(true);
    targetRoles = [];
    await expect(service.canAssignPermission('actor-1', permission)).resolves.toBe(false);
    await expect(service.canRevokePermission('actor-1', permission)).resolves.toBe(false);
    targetRoles = ['events#publish'];
    accountRoles = [];
    await expect(service.canAssignPermission('actor-1', permission)).resolves.toBe(false);
    await expect(service.canRevokePermission('actor-1', permission)).resolves.toBe(false);
  });

  it('keeps explicit delegation capabilities and target-client super-admin restrictions for live roles', async () => {
    const { keycloakService, service } = createContext();
    keycloakService.getUserClientRoles.mockImplementation((_userId, clientId) =>
      Promise.resolve(
        clientId === 'cacic-account-manager' ? ['permission-grant#assign', 'permission-grant#revoke', 'access'] : [],
      ),
    );
    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.Access)).resolves.toBe(false);
    await expect(service.canAssignPermission('actor-1', 'cacic-event-manager:events#publish')).resolves.toBe(false);
    keycloakService.getUserClientRoles.mockResolvedValue(['super-admin']);
    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.PermissionGrantRead)).resolves.toBe(
      false,
    );
  });

  it('does not turn failed live permission lookups into delegation access', async () => {
    const { keycloakService, service } = createContext();
    keycloakService.getUserClientRoles.mockRejectedValue(new Error('Unavailable'));
    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.PermissionGrantRead)).resolves.toBe(
      false,
    );
    await expect(service.canRevokePermission('actor-1', AccountManagerPermission.PermissionGrantRead)).resolves.toBe(
      false,
    );
  });
  it('does not let stale Keycloak roles bypass an inactive locally managed direct grant', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue(['permission-grant#assign']);
    prisma.keycloakPermissionGrant.findMany.mockResolvedValue([
      { permission: AccountManagerPermission.PermissionGrantAssign },
    ]);
    await expect(service.canAssignPermission('actor-1', AccountManagerPermission.PermissionGrantAssign)).resolves.toBe(
      false,
    );
  });

  it('does not let stale inherited Keycloak roles bypass an expired local membership', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue(['permission-grant#read']);
    keycloakService.getGroupClientRoles.mockResolvedValue(['permission-grant#read']);
    prisma.studentEntityMembership.findMany.mockImplementation((args: unknown) => {
      const query = args as { where: { deletedAt?: null } };
      if (query.where.deletedAt === null) {
        return Promise.resolve([]);
      }
      return Promise.resolve([
        {
          entity: PermissionGroupKey.Cacic,
          mandateStart: new Date('2020-01-01'),
          mandateEnd: new Date('2021-01-01'),
        },
      ]);
    });
    await expect(
      service.hasAnyActivePermission('actor-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(false);
  });

  it('does not let stale Keycloak roles bypass an inactive group grant', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue(['permission-grant#read']);
    prisma.studentEntityMembership.findMany.mockResolvedValue([{ entity: PermissionGroupKey.Cacic }]);
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValue([
      { permission: AccountManagerPermission.PermissionGrantRead },
    ]);
    await expect(
      service.hasAnyActivePermission('actor-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(false);
  });
  it('does not authorize a child role through a stale locally expired composite', async () => {
    const { keycloakService, prisma, service } = createContext();
    keycloakService.getUserClientRoles.mockResolvedValue(['old-composite', 'permission-grant#read']);
    prisma.keycloakPermissionGrant.findMany.mockResolvedValue([{ permission: 'cacic-account-manager:old-composite' }]);
    await expect(
      service.hasAnyActivePermission('actor-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(false);
    keycloakService.getUserClientRoles.mockResolvedValue(['permission-grant#read']);
    await expect(
      service.hasAnyActivePermission('actor-1', [AccountManagerPermission.PermissionGrantRead]),
    ).resolves.toBe(true);
  });
});
