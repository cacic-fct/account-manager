import {
  AccountManagerPermission,
  PermissionGroupKey,
  buildKeycloakPermissionId,
} from '@cacic/shared-types';
import { BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { AccountPermissionService } from '../auth/services/account-permission.service';
import {
  KeycloakService,
  KeycloakUserData,
} from '../auth/services/keycloak.service';
import { DiscordRoleService } from '../discord/services/discord-role.service';
import { PrismaService } from '../prisma/prisma.service';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsGrantsService } from './keycloak-permissions-grants.service';
import { KeycloakPermissionsGroupRolesService } from './keycloak-permissions-group-roles.service';
import { KeycloakPermissionsMembershipsService } from './keycloak-permissions-memberships.service';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';
import { SyncPermissionGrantsJob } from './keycloak-permissions.queue';

type GrantRecord = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  studentEntityMembershipId: string | null;
  permission: string;
  clientId: string;
  roleName: string;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date;
  updatedById: string | null;
  deletedAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

type GroupRoleGrantRecord = {
  id: string;
  groupKey: string;
  keycloakGroupId: string;
  permission: string;
  clientId: string;
  roleName: string;
  validFrom: Date | null;
  validUntil: Date | null;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date;
  updatedById: string | null;
  deletedAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
};

type MembershipRecord = {
  id: string;
  entity: string;
  keycloakGroupPath: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  mandateStart: Date;
  mandateEnd: Date | null;
  createdAt: Date;
  createdById: string | null;
  updatedAt: Date;
  updatedById: string | null;
  deletedAt: Date | null;
  lastSyncedAt: Date | null;
  lastSyncError: string | null;
  permissionGrants: GrantRecord[];
};

type PrismaMock = {
  keycloakPermissionGrant: {
    findMany: jest.Mock<Promise<GrantRecord[]>, [unknown]>;
    findFirst: jest.Mock<
      Promise<GrantRecord | { id: string } | null>,
      [unknown]
    >;
    create: jest.Mock<Promise<GrantRecord>, [unknown]>;
    update: jest.Mock<Promise<GrantRecord>, [unknown]>;
  };
  keycloakGroupPermissionGrant: {
    findMany: jest.Mock<Promise<GroupRoleGrantRecord[]>, [unknown]>;
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
    create: jest.Mock<Promise<GroupRoleGrantRecord>, [unknown]>;
    update: jest.Mock<Promise<GroupRoleGrantRecord>, [unknown]>;
  };
  studentEntityMembership: {
    findMany: jest.Mock<Promise<MembershipRecord[]>, [unknown]>;
    findFirst: jest.Mock<
      Promise<MembershipRecord | { id: string } | null>,
      [unknown]
    >;
    create: jest.Mock<Promise<MembershipRecord>, [unknown]>;
    update: jest.Mock<Promise<MembershipRecord>, [unknown]>;
  };
};

type KeycloakMock = {
  listClientRoles: jest.Mock<
    ReturnType<KeycloakService['listClientRoles']>,
    Parameters<KeycloakService['listClientRoles']>
  >;
  getGroupClientRoles: jest.Mock<
    ReturnType<KeycloakService['getGroupClientRoles']>,
    Parameters<KeycloakService['getGroupClientRoles']>
  >;
  addGroupClientRoles: jest.Mock<
    ReturnType<KeycloakService['addGroupClientRoles']>,
    Parameters<KeycloakService['addGroupClientRoles']>
  >;
  removeGroupClientRoles: jest.Mock<
    ReturnType<KeycloakService['removeGroupClientRoles']>,
    Parameters<KeycloakService['removeGroupClientRoles']>
  >;
  getUserBasicInfo: jest.Mock<
    ReturnType<KeycloakService['getUserBasicInfo']>,
    Parameters<KeycloakService['getUserBasicInfo']>
  >;
  addUserClientRoles: jest.Mock<
    ReturnType<KeycloakService['addUserClientRoles']>,
    Parameters<KeycloakService['addUserClientRoles']>
  >;
  removeUserClientRoles: jest.Mock<
    ReturnType<KeycloakService['removeUserClientRoles']>,
    Parameters<KeycloakService['removeUserClientRoles']>
  >;
  addUserToGroupId: jest.Mock<
    ReturnType<KeycloakService['addUserToGroupId']>,
    Parameters<KeycloakService['addUserToGroupId']>
  >;
  removeUserFromGroupId: jest.Mock<
    ReturnType<KeycloakService['removeUserFromGroupId']>,
    Parameters<KeycloakService['removeUserFromGroupId']>
  >;
  searchUsers: jest.Mock<
    ReturnType<KeycloakService['searchUsers']>,
    Parameters<KeycloakService['searchUsers']>
  >;
};

type AccountPermissionMock = {
  canAssignPermission: jest.Mock<
    ReturnType<AccountPermissionService['canAssignPermission']>,
    Parameters<AccountPermissionService['canAssignPermission']>
  >;
  canRevokePermission: jest.Mock<
    ReturnType<AccountPermissionService['canRevokePermission']>,
    Parameters<AccountPermissionService['canRevokePermission']>
  >;
};

type DiscordRoleMock = {
  reconcilePermissionGroupAffiliationRoles: jest.Mock<
    ReturnType<DiscordRoleService['reconcilePermissionGroupAffiliationRoles']>,
    Parameters<DiscordRoleService['reconcilePermissionGroupAffiliationRoles']>
  >;
};

type QueueMock = {
  add: jest.Mock<
    ReturnType<Queue<SyncPermissionGrantsJob>['add']>,
    Parameters<Queue<SyncPermissionGrantsJob>['add']>
  >;
};

const createdAt = new Date('2026-06-21T12:00:00.000Z');
const cacicGroupId = '5470bc10-d4f5-47c7-90cc-a4dd62ecd163';
const cacicGroupPath = '/Entidades estudantis/CACiC';

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

const createUser = (
  overrides: Partial<KeycloakUserData> = {},
): KeycloakUserData => ({
  id: 'user-1',
  email: 'alice@example.com',
  username: 'alice',
  firstName: 'Alice',
  lastName: 'Example',
  enabled: true,
  attributes: {
    fullName: ['Alice Example'],
    'identity-document': ['12345678900'],
  },
  ...overrides,
});

const createGrant = (overrides: Partial<GrantRecord> = {}): GrantRecord => {
  const permission =
    overrides.permission ?? AccountManagerPermission.PermissionGrantRead;
  const [clientId, roleName] = permission.split(':');

  return {
    id: 'grant-1',
    userId: 'user-1',
    userEmail: 'alice@example.com',
    userDisplayName: 'Alice Example',
    studentEntityMembershipId: null,
    permission,
    clientId: overrides.clientId ?? clientId ?? 'cacic-account-manager',
    roleName: overrides.roleName ?? roleName ?? 'permission-grant#read',
    validFrom: null,
    validUntil: null,
    createdAt,
    createdById: 'admin-1',
    updatedAt: createdAt,
    updatedById: 'admin-1',
    deletedAt: null,
    lastSyncedAt: null,
    lastSyncError: null,
    ...overrides,
  };
};

const createGroupRoleGrant = (
  overrides: Partial<GroupRoleGrantRecord> = {},
): GroupRoleGrantRecord => {
  const permission =
    overrides.permission ?? AccountManagerPermission.PermissionGrantRead;
  const [clientId, roleName] = permission.split(':');

  return {
    id: 'group-grant-1',
    groupKey: PermissionGroupKey.Cacic,
    keycloakGroupId: cacicGroupId,
    permission,
    clientId: overrides.clientId ?? clientId ?? 'cacic-account-manager',
    roleName: overrides.roleName ?? roleName ?? 'permission-grant#read',
    validFrom: null,
    validUntil: null,
    createdAt,
    createdById: 'admin-1',
    updatedAt: createdAt,
    updatedById: 'admin-1',
    deletedAt: null,
    lastSyncedAt: null,
    lastSyncError: null,
    ...overrides,
  };
};

const createMembership = (
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord => ({
  id: 'membership-1',
  entity: PermissionGroupKey.Cacic,
  keycloakGroupPath: cacicGroupPath,
  userId: 'user-1',
  userEmail: 'alice@example.com',
  userDisplayName: 'Alice Example',
  mandateStart: new Date(Date.now() - 60 * 1000),
  mandateEnd: null,
  createdAt,
  createdById: 'admin-1',
  updatedAt: createdAt,
  updatedById: 'admin-1',
  deletedAt: null,
  lastSyncedAt: null,
  lastSyncError: null,
  permissionGrants: [],
  ...overrides,
});

const createContext = () => {
  const prisma: PrismaMock = {
    keycloakPermissionGrant: {
      findMany: jest.fn<Promise<GrantRecord[]>, [unknown]>(),
      findFirst: jest.fn<
        Promise<GrantRecord | { id: string } | null>,
        [unknown]
      >(),
      create: jest.fn<Promise<GrantRecord>, [unknown]>(),
      update: jest.fn<Promise<GrantRecord>, [unknown]>(),
    },
    keycloakGroupPermissionGrant: {
      findMany: jest.fn<Promise<GroupRoleGrantRecord[]>, [unknown]>(),
      findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
      create: jest.fn<Promise<GroupRoleGrantRecord>, [unknown]>(),
      update: jest.fn<Promise<GroupRoleGrantRecord>, [unknown]>(),
    },
    studentEntityMembership: {
      findMany: jest.fn<Promise<MembershipRecord[]>, [unknown]>(),
      findFirst: jest.fn<
        Promise<MembershipRecord | { id: string } | null>,
        [unknown]
      >(),
      create: jest.fn<Promise<MembershipRecord>, [unknown]>(),
      update: jest.fn<Promise<MembershipRecord>, [unknown]>(),
    },
  };
  prisma.keycloakPermissionGrant.findMany.mockResolvedValue([]);
  prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValue([]);
  prisma.keycloakGroupPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.studentEntityMembership.findMany.mockResolvedValue([]);
  prisma.studentEntityMembership.findFirst.mockResolvedValue(null);

  const keycloakService: KeycloakMock = {
    listClientRoles: jest.fn<
      ReturnType<KeycloakService['listClientRoles']>,
      Parameters<KeycloakService['listClientRoles']>
    >(),
    getGroupClientRoles: jest.fn<
      ReturnType<KeycloakService['getGroupClientRoles']>,
      Parameters<KeycloakService['getGroupClientRoles']>
    >(),
    addGroupClientRoles: jest.fn<
      ReturnType<KeycloakService['addGroupClientRoles']>,
      Parameters<KeycloakService['addGroupClientRoles']>
    >(),
    removeGroupClientRoles: jest.fn<
      ReturnType<KeycloakService['removeGroupClientRoles']>,
      Parameters<KeycloakService['removeGroupClientRoles']>
    >(),
    getUserBasicInfo: jest.fn<
      ReturnType<KeycloakService['getUserBasicInfo']>,
      Parameters<KeycloakService['getUserBasicInfo']>
    >(),
    addUserClientRoles: jest.fn<
      ReturnType<KeycloakService['addUserClientRoles']>,
      Parameters<KeycloakService['addUserClientRoles']>
    >(),
    removeUserClientRoles: jest.fn<
      ReturnType<KeycloakService['removeUserClientRoles']>,
      Parameters<KeycloakService['removeUserClientRoles']>
    >(),
    addUserToGroupId: jest.fn<
      ReturnType<KeycloakService['addUserToGroupId']>,
      Parameters<KeycloakService['addUserToGroupId']>
    >(),
    removeUserFromGroupId: jest.fn<
      ReturnType<KeycloakService['removeUserFromGroupId']>,
      Parameters<KeycloakService['removeUserFromGroupId']>
    >(),
    searchUsers: jest.fn<
      ReturnType<KeycloakService['searchUsers']>,
      Parameters<KeycloakService['searchUsers']>
    >(),
  };

  keycloakService.listClientRoles.mockImplementation((clientId) => {
    if (clientId === 'cacic-account-manager') {
      return Promise.resolve([
        { id: 'role-access', name: 'access' },
        { id: 'role-grant-read', name: 'permission-grant#read' },
        { id: 'role-hidden', name: 'uma_protection' },
      ]);
    }

    if (clientId === 'cacic-event-manager') {
      return Promise.resolve([
        { id: 'role-events-publish', name: 'events#publish' },
      ]);
    }

    return Promise.resolve([
      { id: 'role-elections-read', name: 'elections#read' },
    ]);
  });
  keycloakService.getGroupClientRoles.mockResolvedValue([]);
  keycloakService.addGroupClientRoles.mockResolvedValue(undefined);
  keycloakService.removeGroupClientRoles.mockResolvedValue(undefined);
  keycloakService.getUserBasicInfo.mockResolvedValue(createUser());
  keycloakService.addUserClientRoles.mockResolvedValue(undefined);
  keycloakService.removeUserClientRoles.mockResolvedValue(undefined);
  keycloakService.addUserToGroupId.mockResolvedValue(undefined);
  keycloakService.removeUserFromGroupId.mockResolvedValue(undefined);
  keycloakService.searchUsers.mockResolvedValue([]);

  const accountPermissionService: AccountPermissionMock = {
    canAssignPermission: jest.fn<
      ReturnType<AccountPermissionService['canAssignPermission']>,
      Parameters<AccountPermissionService['canAssignPermission']>
    >(),
    canRevokePermission: jest.fn<
      ReturnType<AccountPermissionService['canRevokePermission']>,
      Parameters<AccountPermissionService['canRevokePermission']>
    >(),
  };
  accountPermissionService.canAssignPermission.mockResolvedValue(true);
  accountPermissionService.canRevokePermission.mockResolvedValue(true);

  const discordRoleService: DiscordRoleMock = {
    reconcilePermissionGroupAffiliationRoles: jest.fn<
      ReturnType<
        DiscordRoleService['reconcilePermissionGroupAffiliationRoles']
      >,
      Parameters<DiscordRoleService['reconcilePermissionGroupAffiliationRoles']>
    >(),
  };
  discordRoleService.reconcilePermissionGroupAffiliationRoles.mockResolvedValue(
    {
      links: 1,
      rolesAdded: 1,
      rolesRemoved: 0,
    },
  );

  const queue: QueueMock = {
    add: jest.fn<
      ReturnType<Queue<SyncPermissionGrantsJob>['add']>,
      Parameters<Queue<SyncPermissionGrantsJob>['add']>
    >(),
  };

  const catalog = new KeycloakPermissionsCatalogService(
    keycloakService as unknown as KeycloakService,
  );
  const sync = new KeycloakPermissionsSyncService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    discordRoleService as unknown as DiscordRoleService,
  );
  const groupRoles = new KeycloakPermissionsGroupRolesService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    accountPermissionService as unknown as AccountPermissionService,
    catalog,
    sync,
  );
  const memberships = new KeycloakPermissionsMembershipsService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    discordRoleService as unknown as DiscordRoleService,
    accountPermissionService as unknown as AccountPermissionService,
    catalog,
    sync,
  );
  const grants = new KeycloakPermissionsGrantsService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    accountPermissionService as unknown as AccountPermissionService,
    catalog,
    sync,
  );
  const service = new KeycloakPermissionsService(
    catalog,
    groupRoles,
    memberships,
    grants,
    sync,
    queue as unknown as Queue<SyncPermissionGrantsJob>,
  );

  return {
    accountPermissionService,
    discordRoleService,
    keycloakService,
    prisma,
    queue,
    service,
  };
};

describe('KeycloakPermissionsService', () => {
  it('loads role definitions from configured Keycloak clients and hides uma_protection', async () => {
    const { keycloakService, service } = createContext();

    const catalog = await service.listCatalog();

    expect(keycloakService.listClientRoles).toHaveBeenCalledWith(
      'cacic-account-manager',
    );
    expect(keycloakService.listClientRoles).toHaveBeenCalledWith(
      'cacic-event-manager',
    );
    expect(catalog.map((definition) => definition.permission)).toContain(
      AccountManagerPermission.PermissionGrantRead,
    );
    expect(catalog.map((definition) => definition.permission)).toContain(
      buildKeycloakPermissionId('cacic-event-manager', 'events#publish'),
    );
    expect(
      catalog.some((definition) => definition.roleName === 'uma_protection'),
    ).toBe(false);
  });

  it('allows known account-manager permission writes when another client catalog is unavailable', async () => {
    const { keycloakService, prisma, service } = createContext();
    const grant = createGrant();
    keycloakService.listClientRoles.mockImplementation((clientId) => {
      if (clientId === 'cacic-event-manager') {
        return Promise.reject(new Error('Event Manager down'));
      }

      if (clientId === 'cacic-account-manager') {
        return Promise.resolve([
          { id: 'role-grant-read', name: 'permission-grant#read' },
        ]);
      }

      return Promise.resolve([]);
    });
    prisma.keycloakPermissionGrant.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(grant);
    prisma.keycloakPermissionGrant.create.mockResolvedValue(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(grant);

    await expect(
      service.createGrant(
        {
          userId: 'user-1',
          permission: AccountManagerPermission.PermissionGrantRead,
        },
        'admin-1',
      ),
    ).resolves.toEqual(expect.objectContaining({ id: grant.id }));
  });

  it('shows Keycloak-only group roles as active grants', async () => {
    const { keycloakService, service } = createContext();
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        Promise.resolve(
          clientId === 'cacic-account-manager'
            ? ['permission-grant#read', 'uma_protection']
            : [],
        ),
    );

    const grants = await service.listPermissionGroupRoleGrants(
      PermissionGroupKey.Cacic,
    );

    expect(grants).toEqual([
      expect.objectContaining({
        groupKey: PermissionGroupKey.Cacic,
        permission: AccountManagerPermission.PermissionGrantRead,
        source: 'keycloak',
        status: 'active',
      }),
    ]);
  });

  it('updates group role grants and removes stale Keycloak mappings', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const stalePermission = AccountManagerPermission.StudentVerificationReview;
    const createdGrant = createGroupRoleGrant({ permission });

    prisma.keycloakGroupPermissionGrant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdGrant]);
    prisma.keycloakGroupPermissionGrant.create.mockResolvedValue(createdGrant);
    prisma.keycloakGroupPermissionGrant.update.mockResolvedValue(createdGrant);
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        Promise.resolve(
          clientId === 'cacic-account-manager'
            ? ['student-verification#review']
            : [],
        ),
    );

    await service.updatePermissionGroupRoleGrants(
      PermissionGroupKey.Cacic,
      { permissions: [permission] },
      'admin-1',
    );

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      stalePermission,
    );
    expect(keycloakService.addGroupClientRoles).toHaveBeenCalledWith(
      cacicGroupId,
      ['permission-grant#read'],
      'cacic-account-manager',
    );
    expect(keycloakService.removeGroupClientRoles).toHaveBeenCalledWith(
      cacicGroupId,
      ['student-verification#review'],
      'cacic-account-manager',
    );
    expect(
      keycloakService.removeGroupClientRoles.mock.invocationCallOrder[0],
    ).toBeLessThan(
      keycloakService.addGroupClientRoles.mock.invocationCallOrder[0],
    );

    const createArgs = getMockArg<{
      data: {
        groupKey: PermissionGroupKey;
        keycloakGroupId: string;
        permission: string;
        clientId: string;
        roleName: string;
        createdById: string;
      };
    }>(prisma.keycloakGroupPermissionGrant.create);
    expect(createArgs.data).toMatchObject({
      groupKey: PermissionGroupKey.Cacic,
      keycloakGroupId: cacicGroupId,
      permission,
      clientId: 'cacic-account-manager',
      roleName: 'permission-grant#read',
      createdById: 'admin-1',
    });
  });

  it('does not require assignment or create duplicate grants for unchanged Keycloak-only group roles', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;

    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        Promise.resolve(
          clientId === 'cacic-account-manager' ? ['permission-grant#read'] : [],
        ),
    );

    await service.updatePermissionGroupRoleGrants(
      PermissionGroupKey.Cacic,
      { permissions: [permission] },
      'admin-1',
    );

    expect(accountPermissionService.canAssignPermission).not.toHaveBeenCalled();
    expect(accountPermissionService.canRevokePermission).not.toHaveBeenCalled();
    expect(prisma.keycloakGroupPermissionGrant.create).not.toHaveBeenCalled();
    expect(keycloakService.addGroupClientRoles).not.toHaveBeenCalled();
    expect(keycloakService.removeGroupClientRoles).not.toHaveBeenCalled();
  });

  it('preflights group role removals before creating new grants', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const stalePermission = AccountManagerPermission.StudentVerificationReview;
    accountPermissionService.canRevokePermission.mockResolvedValue(false);
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        Promise.resolve(
          clientId === 'cacic-account-manager'
            ? ['student-verification#review']
            : [],
        ),
    );

    await expect(
      service.updatePermissionGroupRoleGrants(
        PermissionGroupKey.Cacic,
        { permissions: [permission] },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Você não pode revogar uma permissão que não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      stalePermission,
    );
    expect(prisma.keycloakGroupPermissionGrant.create).not.toHaveBeenCalled();
    expect(keycloakService.addGroupClientRoles).not.toHaveBeenCalled();
  });

  it('updates available group role clients when another managed client is unavailable', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const stalePermission = AccountManagerPermission.StudentVerificationReview;
    const createdGrant = createGroupRoleGrant({ permission });

    prisma.keycloakGroupPermissionGrant.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([createdGrant]);
    prisma.keycloakGroupPermissionGrant.create.mockResolvedValue(createdGrant);
    prisma.keycloakGroupPermissionGrant.update.mockResolvedValue(createdGrant);
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) => {
        if (clientId === 'cacic-account-manager') {
          return Promise.resolve(['student-verification#review']);
        }

        if (clientId === 'cacic-event-manager') {
          return Promise.reject(new Error('Event Manager down'));
        }

        return Promise.resolve([]);
      },
    );

    await service.updatePermissionGroupRoleGrants(
      PermissionGroupKey.Cacic,
      { permissions: [permission] },
      'admin-1',
    );

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      stalePermission,
    );
    expect(keycloakService.addGroupClientRoles).toHaveBeenCalledWith(
      cacicGroupId,
      ['permission-grant#read'],
      'cacic-account-manager',
    );
    expect(keycloakService.removeGroupClientRoles).toHaveBeenCalledWith(
      cacicGroupId,
      ['student-verification#review'],
      'cacic-account-manager',
    );
  });

  it('rejects desired group role changes for unavailable clients', async () => {
    const { keycloakService, prisma, service } = createContext();
    const eventPermission = 'cacic-event-manager:events#publish';
    keycloakService.getGroupClientRoles.mockImplementation(
      (_groupId, clientId) =>
        clientId === 'cacic-event-manager'
          ? Promise.reject(new Error('Event Manager down'))
          : Promise.resolve([]),
    );

    await expect(
      service.updatePermissionGroupRoleGrants(
        PermissionGroupKey.Cacic,
        { permissions: [eventPermission] },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Permissões do grupo indisponíveis para: cacic-event-manager.',
      },
    });

    expect(prisma.keycloakGroupPermissionGrant.create).not.toHaveBeenCalled();
    expect(keycloakService.addGroupClientRoles).not.toHaveBeenCalled();
    expect(keycloakService.removeGroupClientRoles).not.toHaveBeenCalled();
  });

  it('creates a permission group membership and reconciles Keycloak plus Discord side effects', async () => {
    const { discordRoleService, keycloakService, prisma, service } =
      createContext();
    const membership = createMembership();
    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(membership);
    prisma.studentEntityMembership.create.mockResolvedValue(membership);
    prisma.studentEntityMembership.update.mockResolvedValue(membership);

    const result = await service.createPermissionGroupMembership(
      {
        userId: 'user-1',
        groupKey: PermissionGroupKey.Cacic,
        validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
        validUntil: null,
      },
      'admin-1',
    );

    expect(keycloakService.addUserToGroupId).toHaveBeenCalledWith(
      'user-1',
      cacicGroupId,
      cacicGroupPath,
    );
    expect(
      discordRoleService.reconcilePermissionGroupAffiliationRoles,
    ).toHaveBeenCalledWith('user-1', 'permission-group-membership-created');
    expect(result).toEqual(
      expect.objectContaining({
        id: 'membership-1',
        groupKey: PermissionGroupKey.Cacic,
        keycloakGroupId: cacicGroupId,
        status: 'active',
      }),
    );

    const createArgs = getMockArg<{
      data: {
        entity: PermissionGroupKey;
        keycloakGroupPath: string;
        userEmail: string;
        userDisplayName: string;
      };
    }>(prisma.studentEntityMembership.create);
    expect(createArgs.data).toMatchObject({
      entity: PermissionGroupKey.Cacic,
      keycloakGroupPath: cacicGroupPath,
      userEmail: 'alice@example.com',
      userDisplayName: 'Alice Example',
    });
  });

  it('checks target group permissions before creating a membership', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const groupGrant = createGroupRoleGrant({ permission });
    const membership = createMembership();
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValue([
      groupGrant,
    ]);
    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(membership);
    prisma.studentEntityMembership.create.mockResolvedValue(membership);
    prisma.studentEntityMembership.update.mockResolvedValue(membership);

    await service.createPermissionGroupMembership(
      {
        userId: 'user-1',
        groupKey: PermissionGroupKey.Cacic,
        validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
        validUntil: null,
      },
      'admin-1',
    );

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
  });

  it('does not deactivate membership-linked grants when memberships stay active', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const groupGrant = createGroupRoleGrant({ permission });
    const legacyGrant = createGrant({
      id: 'legacy-grant-1',
      studentEntityMembershipId: 'membership-1',
    });
    const membership = createMembership({
      permissionGrants: [legacyGrant],
    });
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValue([
      groupGrant,
    ]);
    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(membership);
    prisma.studentEntityMembership.update.mockResolvedValue(membership);
    prisma.keycloakPermissionGrant.update.mockResolvedValue({
      ...legacyGrant,
      deletedAt: new Date(),
    });

    await service.updatePermissionGroupMembership(
      'membership-1',
      {
        validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
        validUntil: null,
      },
      'admin-1',
    );

    expect(keycloakService.removeUserClientRoles).not.toHaveBeenCalled();
    expect(prisma.keycloakPermissionGrant.update).not.toHaveBeenCalled();
    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(accountPermissionService.canRevokePermission).not.toHaveBeenCalled();
  });

  it('rejects active membership extensions when the actor cannot assign group permissions', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const groupGrant = createGroupRoleGrant({ permission });
    const membership = createMembership();
    accountPermissionService.canAssignPermission.mockResolvedValue(false);
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValueOnce([
      groupGrant,
    ]);
    prisma.studentEntityMembership.findFirst.mockResolvedValueOnce(membership);

    await expect(
      service.updatePermissionGroupMembership(
        'membership-1',
        {
          validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
          validUntil: null,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message:
          'Você não pode vincular pessoas a um grupo que concede permissões que você não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(prisma.studentEntityMembership.update).not.toHaveBeenCalled();
  });

  it('rejects future membership access when the actor cannot assign group permissions', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const groupGrant = createGroupRoleGrant({ permission });
    const membership = createMembership({
      mandateStart: new Date(Date.now() + 60 * 60 * 1000),
    });
    accountPermissionService.canAssignPermission.mockResolvedValue(false);
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValueOnce([
      groupGrant,
    ]);
    prisma.studentEntityMembership.findFirst.mockResolvedValueOnce(membership);

    await expect(
      service.updatePermissionGroupMembership(
        'membership-1',
        {
          validFrom: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          validUntil: null,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message:
          'Você não pode vincular pessoas a um grupo que concede permissões que você não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(prisma.studentEntityMembership.update).not.toHaveBeenCalled();
  });

  it('requires revoke permission before shortening active membership access', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const permission = AccountManagerPermission.PermissionGrantRead;
    const groupGrant = createGroupRoleGrant({ permission });
    const membership = createMembership();
    accountPermissionService.canRevokePermission.mockResolvedValue(false);
    prisma.keycloakGroupPermissionGrant.findMany.mockResolvedValue([
      groupGrant,
    ]);
    prisma.studentEntityMembership.findFirst.mockResolvedValueOnce(membership);

    await expect(
      service.updatePermissionGroupMembership(
        'membership-1',
        {
          validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
          validUntil: new Date(Date.now() + 60 * 1000).toISOString(),
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message:
          'Você não pode remover pessoas de um grupo que concede permissões que você não pode revogar.',
      },
    });

    expect(accountPermissionService.canAssignPermission).not.toHaveBeenCalled();
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      permission,
    );
    expect(prisma.studentEntityMembership.update).not.toHaveBeenCalled();
  });

  it('deactivates legacy membership-linked grants when memberships become inactive', async () => {
    const { keycloakService, prisma, service } = createContext();
    const legacyGrant = createGrant({
      id: 'legacy-grant-1',
      studentEntityMembershipId: 'membership-1',
    });
    const membership = createMembership({
      permissionGrants: [legacyGrant],
    });
    const inactiveMembership = createMembership({
      mandateEnd: new Date(Date.now() - 1000),
      permissionGrants: [legacyGrant],
    });
    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(membership)
      .mockResolvedValueOnce(inactiveMembership);
    prisma.studentEntityMembership.update.mockResolvedValue(inactiveMembership);
    prisma.keycloakPermissionGrant.update.mockResolvedValue({
      ...legacyGrant,
      deletedAt: new Date(),
    });

    await service.updatePermissionGroupMembership(
      'membership-1',
      {
        validFrom: new Date(Date.now() - 60 * 1000).toISOString(),
        validUntil: new Date(Date.now() - 1000).toISOString(),
      },
      'admin-1',
    );

    expect(keycloakService.removeUserClientRoles).toHaveBeenCalledWith(
      'user-1',
      ['permission-grant#read'],
      'cacic-account-manager',
    );
    const updateArgs = getMockArg<{
      where: { id: string };
      data: {
        deletedAt: Date;
        updatedById: string;
        lastSyncError: null;
      };
    }>(prisma.keycloakPermissionGrant.update, 1);
    expect(updateArgs.where).toEqual({ id: 'legacy-grant-1' });
    expect(updateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(updateArgs.data.updatedById).toBe('admin-1');
    expect(updateArgs.data.lastSyncError).toBeNull();
  });

  it('creates a direct grant and assigns only the parsed client role in Keycloak', async () => {
    const { keycloakService, prisma, service } = createContext();
    const permission = buildKeycloakPermissionId(
      'cacic-event-manager',
      'events#publish',
    );
    const grant = createGrant({ permission });
    prisma.keycloakPermissionGrant.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(grant);
    prisma.keycloakPermissionGrant.create.mockResolvedValue(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(grant);

    const result = await service.createGrant(
      {
        userId: 'user-1',
        permission,
      },
      'admin-1',
    );

    expect(keycloakService.addUserClientRoles).toHaveBeenCalledWith(
      'user-1',
      ['events#publish'],
      'cacic-event-manager',
    );
    expect(result).toEqual(
      expect.objectContaining({
        permission,
        clientId: 'cacic-event-manager',
        roleName: 'events#publish',
      }),
    );

    const createArgs = getMockArg<{
      data: {
        permission: string;
        clientId: string;
        roleName: string;
      };
    }>(prisma.keycloakPermissionGrant.create);
    expect(createArgs.data).toMatchObject({
      permission,
      clientId: 'cacic-event-manager',
      roleName: 'events#publish',
    });
  });

  it('rejects duplicate non-deleted scheduled direct grants before create', async () => {
    const { keycloakService, prisma, service } = createContext();
    const existingGrant = createGrant({
      validFrom: new Date(Date.now() + 60 * 60 * 1000),
      validUntil: null,
    });
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(
      existingGrant,
    );

    await expect(
      service.createGrant(
        {
          userId: 'user-1',
          permission: existingGrant.permission,
          validFrom: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          validUntil: null,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message:
          'Essa permissão já foi concedida para essa pessoa. Atualize ou remova a concessão atual antes de criar outra.',
      },
    });

    expect(prisma.keycloakPermissionGrant.create).not.toHaveBeenCalled();
    expect(keycloakService.addUserClientRoles).not.toHaveBeenCalled();
  });

  it('allows revoke-only actors to expire an active direct grant', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const validUntil = new Date(Date.now() - 60 * 1000);
    const existingGrant = createGrant();
    const expiredGrant = createGrant({
      validUntil,
      updatedById: 'admin-1',
    });
    accountPermissionService.canAssignPermission.mockResolvedValue(false);
    accountPermissionService.canRevokePermission.mockResolvedValue(true);
    prisma.keycloakPermissionGrant.findFirst
      .mockResolvedValueOnce(existingGrant)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(expiredGrant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(expiredGrant);

    await expect(
      service.updateGrant(
        existingGrant.id,
        {
          validUntil: validUntil.toISOString(),
        },
        'admin-1',
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        id: existingGrant.id,
        validUntil: validUntil.toISOString(),
      }),
    );

    expect(accountPermissionService.canAssignPermission).not.toHaveBeenCalled();
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      existingGrant.permission,
    );
    expect(keycloakService.removeUserClientRoles).toHaveBeenCalledWith(
      existingGrant.userId,
      [existingGrant.roleName],
      existingGrant.clientId,
    );
  });

  it('requires assign permission to keep an active direct grant active with a validity change', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const validUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const existingGrant = createGrant({
      validUntil: new Date(Date.now() + 60 * 1000),
    });
    accountPermissionService.canAssignPermission.mockResolvedValue(false);
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(
      existingGrant,
    );

    await expect(
      service.updateGrant(
        existingGrant.id,
        {
          validUntil: validUntil.toISOString(),
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Você não pode conceder uma permissão que não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      existingGrant.permission,
    );
    expect(accountPermissionService.canRevokePermission).not.toHaveBeenCalled();
    expect(prisma.keycloakPermissionGrant.update).not.toHaveBeenCalled();
  });

  it('requires assign permission before scheduling future direct grant access', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const existingGrant = createGrant({
      validFrom: new Date(Date.now() + 60 * 60 * 1000),
      permission: AccountManagerPermission.PermissionGrantRead,
    });
    const nextPermission = AccountManagerPermission.DiscordManagementUpdate;
    accountPermissionService.canAssignPermission.mockResolvedValue(false);
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(
      existingGrant,
    );

    await expect(
      service.updateGrant(
        existingGrant.id,
        {
          permission: nextPermission,
          validFrom: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(),
          validUntil: null,
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Você não pode conceder uma permissão que não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      nextPermission,
    );
    expect(prisma.keycloakPermissionGrant.update).not.toHaveBeenCalled();
  });

  it('requires revoke permission before shortening active direct grant access', async () => {
    const { accountPermissionService, prisma, service } = createContext();
    const existingGrant = createGrant({
      validUntil: null,
    });
    accountPermissionService.canRevokePermission.mockResolvedValue(false);
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(
      existingGrant,
    );

    await expect(
      service.updateGrant(
        existingGrant.id,
        {
          validUntil: new Date(Date.now() + 60 * 1000).toISOString(),
        },
        'admin-1',
      ),
    ).rejects.toMatchObject({
      response: {
        message: 'Você não pode revogar uma permissão que não possui.',
      },
    });

    expect(accountPermissionService.canAssignPermission).toHaveBeenCalledWith(
      'admin-1',
      existingGrant.permission,
    );
    expect(accountPermissionService.canRevokePermission).toHaveBeenCalledWith(
      'admin-1',
      existingGrant.permission,
    );
    expect(prisma.keycloakPermissionGrant.update).not.toHaveBeenCalled();
  });

  it('marks direct grants deleted after removing the external Keycloak role', async () => {
    const { keycloakService, prisma, service } = createContext();
    const grant = createGrant();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue({
      ...grant,
      deletedAt: new Date(),
    });

    await service.deleteGrant(grant.id, 'admin-1');

    const deleteUpdateArgs = getMockArg<{
      data: { deletedAt: Date; lastSyncedAt: Date; lastSyncError: null };
    }>(prisma.keycloakPermissionGrant.update);
    expect(deleteUpdateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(deleteUpdateArgs.data.lastSyncedAt).toBeInstanceOf(Date);
    expect(deleteUpdateArgs.data.lastSyncError).toBeNull();
    expect(
      keycloakService.removeUserClientRoles.mock.invocationCallOrder[0],
    ).toBeLessThan(
      prisma.keycloakPermissionGrant.update.mock.invocationCallOrder[0],
    );
  });

  it('keeps direct grants visible for retry when Keycloak role removal fails', async () => {
    const { keycloakService, prisma, service } = createContext();
    const grant = createGrant();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(grant);
    keycloakService.removeUserClientRoles.mockRejectedValueOnce(
      new Error('Keycloak down'),
    );

    await expect(service.deleteGrant(grant.id, 'admin-1')).rejects.toThrow(
      'Keycloak down',
    );

    const failureUpdateArgs = getMockArg<{
      data: { deletedAt?: Date; lastSyncError: string };
    }>(prisma.keycloakPermissionGrant.update);
    expect(failureUpdateArgs.data.deletedAt).toBeUndefined();
    expect(failureUpdateArgs.data.lastSyncError).toBe('Keycloak down');
  });

  it('marks direct grants deleted when the external Keycloak role is already gone', async () => {
    const { keycloakService, prisma, service } = createContext();
    const grant = createGrant();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValueOnce(grant);
    keycloakService.removeUserClientRoles.mockRejectedValueOnce(
      new Error(
        `Keycloak client role ${grant.clientId}:${grant.roleName} was not found`,
      ),
    );

    await expect(
      service.deleteGrant(grant.id, 'admin-1'),
    ).resolves.toBeUndefined();

    const deleteUpdateArgs = getMockArg<{
      data: {
        deletedAt: Date;
        updatedById: string;
        lastSyncedAt: Date;
        lastSyncError: null;
      };
    }>(prisma.keycloakPermissionGrant.update);
    expect(deleteUpdateArgs.data.deletedAt).toBeInstanceOf(Date);
    expect(deleteUpdateArgs.data.updatedById).toBe('admin-1');
    expect(deleteUpdateArgs.data.lastSyncedAt).toBeInstanceOf(Date);
    expect(deleteUpdateArgs.data.lastSyncError).toBeNull();
  });

  it('rejects hidden Keycloak roles', async () => {
    const { service } = createContext();

    await expect(
      service.createGrant(
        {
          userId: 'user-1',
          permission: buildKeycloakPermissionId(
            'cacic-account-manager',
            'uma_protection',
          ),
        },
        'admin-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lets users remove their own direct grants without assign permissions', async () => {
    const { accountPermissionService, keycloakService, prisma, service } =
      createContext();
    const grant = createGrant();
    prisma.keycloakPermissionGrant.findFirst
      .mockResolvedValueOnce({ id: grant.id })
      .mockResolvedValueOnce(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue({
      ...grant,
      deletedAt: new Date(),
    });

    await expect(service.selfRemoveGrant('user-1', grant.id)).resolves.toEqual({
      removed: true,
      id: grant.id,
    });

    expect(accountPermissionService.canAssignPermission).not.toHaveBeenCalled();
    expect(accountPermissionService.canRevokePermission).not.toHaveBeenCalled();
    expect(keycloakService.removeUserClientRoles).toHaveBeenCalledWith(
      'user-1',
      ['permission-grant#read'],
      'cacic-account-manager',
    );
  });
});
