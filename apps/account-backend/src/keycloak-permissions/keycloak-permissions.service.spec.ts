import { AssignableKeycloakPermission } from '@cacic/shared-types';
import { BadRequestException } from '@nestjs/common';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  KeycloakService,
  KeycloakUserData,
} from '../auth/services/keycloak.service';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import { SyncPermissionGrantsJob } from './keycloak-permissions.queue';

type GrantRecord = {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  studentEntityMembershipId: string | null;
  permission: string;
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
  mandateEnd: Date;
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
    findFirst: jest.Mock<Promise<GrantRecord | null>, [unknown]>;
    findUnique: jest.Mock<Promise<GrantRecord | null>, [unknown]>;
    create: jest.Mock<Promise<GrantRecord>, [unknown]>;
    update: jest.Mock<Promise<GrantRecord>, [unknown]>;
  };
  studentEntityMembership: {
    findMany: jest.Mock<Promise<MembershipRecord[]>, [unknown]>;
    findFirst: jest.Mock<Promise<MembershipRecord | null>, [unknown]>;
    create: jest.Mock<Promise<MembershipRecord>, [unknown]>;
    update: jest.Mock<Promise<MembershipRecord>, [unknown]>;
  };
};

type KeycloakMock = {
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
  addUserToGroupPath: jest.Mock<
    ReturnType<KeycloakService['addUserToGroupPath']>,
    Parameters<KeycloakService['addUserToGroupPath']>
  >;
  removeUserFromGroupPath: jest.Mock<
    ReturnType<KeycloakService['removeUserFromGroupPath']>,
    Parameters<KeycloakService['removeUserFromGroupPath']>
  >;
  searchUsers: jest.Mock<
    ReturnType<KeycloakService['searchUsers']>,
    Parameters<KeycloakService['searchUsers']>
  >;
};

type QueueMock = {
  add: jest.Mock<
    ReturnType<Queue<SyncPermissionGrantsJob>['add']>,
    Parameters<Queue<SyncPermissionGrantsJob>['add']>
  >;
};

const createdAt = new Date('2026-06-21T12:00:00.000Z');

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

const createGrant = (overrides: Partial<GrantRecord> = {}): GrantRecord => ({
  id: 'grant-1',
  userId: 'user-1',
  userEmail: 'alice@example.com',
  userDisplayName: 'Alice Example',
  studentEntityMembershipId: null,
  permission: AssignableKeycloakPermission.AccountManagerAccess,
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
});

const createMembership = (
  overrides: Partial<MembershipRecord> = {},
): MembershipRecord => ({
  id: 'membership-1',
  entity: 'CACIC',
  keycloakGroupPath: '/student-entities/cacic',
  userId: 'user-1',
  userEmail: 'alice@example.com',
  userDisplayName: 'Alice Example',
  mandateStart: new Date(Date.now() - 60 * 1000),
  mandateEnd: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
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

const createContext = () => {
  const prisma: PrismaMock = {
    keycloakPermissionGrant: {
      findMany: jest.fn<Promise<GrantRecord[]>, [unknown]>(),
      findFirst: jest.fn<Promise<GrantRecord | null>, [unknown]>(),
      findUnique: jest.fn<Promise<GrantRecord | null>, [unknown]>(),
      create: jest.fn<Promise<GrantRecord>, [unknown]>(),
      update: jest.fn<Promise<GrantRecord>, [unknown]>(),
    },
    studentEntityMembership: {
      findMany: jest.fn<Promise<MembershipRecord[]>, [unknown]>(),
      findFirst: jest.fn<Promise<MembershipRecord | null>, [unknown]>(),
      create: jest.fn<Promise<MembershipRecord>, [unknown]>(),
      update: jest.fn<Promise<MembershipRecord>, [unknown]>(),
    },
  };
  prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);
  prisma.keycloakPermissionGrant.findMany.mockResolvedValue([]);
  prisma.studentEntityMembership.findFirst.mockResolvedValue(null);
  prisma.studentEntityMembership.findMany.mockResolvedValue([]);

  const keycloakService: KeycloakMock = {
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
    addUserToGroupPath: jest.fn<
      ReturnType<KeycloakService['addUserToGroupPath']>,
      Parameters<KeycloakService['addUserToGroupPath']>
    >(),
    removeUserFromGroupPath: jest.fn<
      ReturnType<KeycloakService['removeUserFromGroupPath']>,
      Parameters<KeycloakService['removeUserFromGroupPath']>
    >(),
    searchUsers: jest.fn<
      ReturnType<KeycloakService['searchUsers']>,
      Parameters<KeycloakService['searchUsers']>
    >(),
  };
  keycloakService.getUserBasicInfo.mockResolvedValue(createUser());
  keycloakService.addUserClientRoles.mockResolvedValue(undefined);
  keycloakService.removeUserClientRoles.mockResolvedValue(undefined);
  keycloakService.addUserToGroupPath.mockResolvedValue(undefined);
  keycloakService.removeUserFromGroupPath.mockResolvedValue(undefined);
  keycloakService.searchUsers.mockResolvedValue([]);

  const queue: QueueMock = {
    add: jest.fn<
      ReturnType<Queue<SyncPermissionGrantsJob>['add']>,
      Parameters<Queue<SyncPermissionGrantsJob>['add']>
    >(),
  };

  const service = new KeycloakPermissionsService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    queue as unknown as Queue<SyncPermissionGrantsJob>,
  );

  return {
    service,
    prisma,
    keycloakService,
    queue,
  };
};

describe('KeycloakPermissionsService', () => {
  it('creates an immediate grant and assigns the direct Keycloak client role', async () => {
    const { service, prisma, keycloakService } = createContext();
    const grant = createGrant();
    const syncedGrant = createGrant({
      lastSyncedAt: new Date('2026-06-21T12:01:00.000Z'),
    });
    prisma.keycloakPermissionGrant.create.mockResolvedValue(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(syncedGrant);
    prisma.keycloakPermissionGrant.findUnique.mockResolvedValue(syncedGrant);

    const result = await service.createGrant(
      {
        userId: 'user-1',
        permission: AssignableKeycloakPermission.AccountManagerAccess,
      },
      'admin-1',
    );

    expect(keycloakService.addUserClientRoles).toHaveBeenCalledWith('user-1', [
      AssignableKeycloakPermission.AccountManagerAccess,
    ]);
    const createArgs = getMockArg<{
      data: {
        userId: string;
        permission: string;
        userEmail: string;
        userDisplayName: string;
        createdById: string;
        updatedById: string;
      };
    }>(prisma.keycloakPermissionGrant.create);
    expect(createArgs.data).toMatchObject({
      userId: 'user-1',
      permission: AssignableKeycloakPermission.AccountManagerAccess,
      userEmail: 'alice@example.com',
      userDisplayName: 'Alice Example',
      createdById: 'admin-1',
      updatedById: 'admin-1',
    });
    expect(result.status).toBe('active');
  });

  it('returns a created grant with sync drift when immediate Keycloak assignment fails', async () => {
    const { service, prisma, keycloakService } = createContext();
    const grant = createGrant();
    const failedGrant = createGrant({
      lastSyncError: 'Keycloak unavailable',
    });
    prisma.keycloakPermissionGrant.create.mockResolvedValue(grant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(failedGrant);
    prisma.keycloakPermissionGrant.findUnique.mockResolvedValue(failedGrant);
    keycloakService.addUserClientRoles.mockRejectedValue(
      new Error('Keycloak unavailable'),
    );

    const result = await service.createGrant(
      {
        userId: 'user-1',
        permission: AssignableKeycloakPermission.AccountManagerAccess,
      },
      'admin-1',
    );

    expect(result.lastSyncError).toBe('Keycloak unavailable');
    const updateArgs = getMockArg<{
      where: { id: string };
      data: { lastSyncError: string };
    }>(prisma.keycloakPermissionGrant.update);
    expect(updateArgs.where).toEqual({ id: 'grant-1' });
    expect(updateArgs.data.lastSyncError).toBe('Keycloak unavailable');
  });

  it('keeps a future grant scheduled until the sync window activates it', async () => {
    const { service, prisma, keycloakService } = createContext();
    const validFrom = new Date(Date.now() + 60 * 60 * 1000);
    const grant = createGrant({ validFrom });
    prisma.keycloakPermissionGrant.create.mockResolvedValue(grant);
    prisma.keycloakPermissionGrant.findUnique.mockResolvedValue(grant);

    const result = await service.createGrant({
      userId: 'user-1',
      permission: AssignableKeycloakPermission.AccountManagerSuperAdmin,
      validFrom: validFrom.toISOString(),
    });

    expect(keycloakService.addUserClientRoles).not.toHaveBeenCalled();
    expect(result.status).toBe('scheduled');
  });

  it('removes expired grants from Keycloak during synchronization', async () => {
    const { service, prisma, keycloakService } = createContext();
    const expiredGrant = createGrant({
      validUntil: new Date(Date.now() - 60 * 1000),
    });
    prisma.keycloakPermissionGrant.findMany.mockResolvedValue([expiredGrant]);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(
      createGrant({ deletedAt: new Date() }),
    );

    const result = await service.synchronizePermissionGrants();

    expect(keycloakService.removeUserClientRoles).toHaveBeenCalledWith(
      'user-1',
      [AssignableKeycloakPermission.AccountManagerAccess],
    );
    const updateArgs = getMockArg<{
      where: { id: string };
      data: { updatedById: string };
    }>(prisma.keycloakPermissionGrant.update);
    expect(updateArgs.where).toEqual({ id: 'grant-1' });
    expect(updateArgs.data.updatedById).toBe(
      'system:keycloak-permissions-sync',
    );
    expect(result).toEqual({ activated: 0, expired: 1, failed: 0 });
  });

  it('creates a student entity membership, syncs its Keycloak group, and links scoped grants', async () => {
    const { service, prisma, keycloakService } = createContext();
    const mandateStart = new Date(Date.now() - 60 * 1000);
    const mandateEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const membership = createMembership({ mandateStart, mandateEnd });
    const linkedGrant = createGrant({
      id: 'grant-entity-1',
      studentEntityMembershipId: membership.id,
      validFrom: mandateStart,
      validUntil: mandateEnd,
    });
    const finalMembership = createMembership({
      mandateStart,
      mandateEnd,
      lastSyncedAt: new Date('2026-06-21T12:02:00.000Z'),
      permissionGrants: [linkedGrant],
    });

    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(finalMembership);
    prisma.studentEntityMembership.create.mockResolvedValue(membership);
    prisma.studentEntityMembership.update.mockResolvedValue(finalMembership);
    prisma.keycloakPermissionGrant.create.mockResolvedValue(linkedGrant);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(linkedGrant);

    const result = await service.createStudentEntityMembership(
      {
        entity: 'CACIC',
        userId: 'user-1',
        mandateStart: mandateStart.toISOString(),
        mandateEnd: mandateEnd.toISOString(),
        permissions: [AssignableKeycloakPermission.AccountManagerAccess],
      },
      'admin-1',
    );

    expect(keycloakService.addUserToGroupPath).toHaveBeenCalledWith(
      'user-1',
      '/student-entities/cacic',
    );
    expect(keycloakService.addUserClientRoles).toHaveBeenCalledWith('user-1', [
      AssignableKeycloakPermission.AccountManagerAccess,
    ]);
    const createArgs = getMockArg<{
      data: {
        studentEntityMembershipId: string;
        validFrom: Date;
        validUntil: Date;
      };
    }>(prisma.keycloakPermissionGrant.create);
    expect(createArgs.data.studentEntityMembershipId).toBe('membership-1');
    expect(createArgs.data.validFrom).toBe(mandateStart);
    expect(createArgs.data.validUntil).toBe(mandateEnd);
    expect(result.entity).toBe('CACIC');
    expect(result.permissionGrants).toHaveLength(1);
  });

  it('returns a created student entity membership with sync drift when Keycloak group sync fails', async () => {
    const { service, prisma, keycloakService } = createContext();
    const mandateStart = new Date(Date.now() - 60 * 1000);
    const mandateEnd = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const membership = createMembership({ mandateStart, mandateEnd });
    const failedMembership = createMembership({
      mandateStart,
      mandateEnd,
      lastSyncError: 'Keycloak group unavailable',
    });

    prisma.studentEntityMembership.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(failedMembership);
    prisma.studentEntityMembership.create.mockResolvedValue(membership);
    prisma.studentEntityMembership.update.mockResolvedValue(failedMembership);
    keycloakService.addUserToGroupPath.mockRejectedValue(
      new Error('Keycloak group unavailable'),
    );

    const result = await service.createStudentEntityMembership(
      {
        entity: 'CACIC',
        userId: 'user-1',
        mandateStart: mandateStart.toISOString(),
        mandateEnd: mandateEnd.toISOString(),
        permissions: [],
      },
      'admin-1',
    );

    expect(result.lastSyncError).toBe('Keycloak group unavailable');
    const updateArgs = getMockArg<{
      where: { id: string };
      data: { lastSyncError: string };
    }>(prisma.studentEntityMembership.update);
    expect(updateArgs.where).toEqual({ id: 'membership-1' });
    expect(updateArgs.data.lastSyncError).toBe('Keycloak group unavailable');
  });

  it('removes expired memberships from Keycloak and expires linked grants', async () => {
    const { service, prisma, keycloakService } = createContext();
    const mandateStart = new Date(Date.now() - 120 * 60 * 1000);
    const mandateEnd = new Date(Date.now() - 60 * 1000);
    const linkedGrant = createGrant({
      id: 'grant-entity-1',
      studentEntityMembershipId: 'membership-1',
      validFrom: mandateStart,
      validUntil: mandateEnd,
    });
    const expiredMembership = createMembership({
      mandateStart,
      mandateEnd,
      permissionGrants: [linkedGrant],
    });

    prisma.studentEntityMembership.findMany.mockResolvedValue([
      expiredMembership,
    ]);
    prisma.keycloakPermissionGrant.update.mockResolvedValue(
      createGrant({
        id: 'grant-entity-1',
        studentEntityMembershipId: 'membership-1',
        deletedAt: new Date(),
      }),
    );
    prisma.studentEntityMembership.update.mockResolvedValue(
      createMembership({ deletedAt: new Date() }),
    );

    const result = await service.synchronizeStudentEntityMemberships();

    expect(keycloakService.removeUserFromGroupPath).toHaveBeenCalledWith(
      'user-1',
      '/student-entities/cacic',
    );
    const grantUpdateArgs = getMockArg<{
      where: { id: string };
      data: { updatedById: string };
    }>(prisma.keycloakPermissionGrant.update);
    const membershipUpdateArgs = getMockArg<{
      where: { id: string };
      data: { updatedById: string };
    }>(prisma.studentEntityMembership.update);
    expect(grantUpdateArgs.where).toEqual({ id: 'grant-entity-1' });
    expect(grantUpdateArgs.data.updatedById).toBe(
      'system:keycloak-permissions-sync',
    );
    expect(membershipUpdateArgs.where).toEqual({ id: 'membership-1' });
    expect(membershipUpdateArgs.data.updatedById).toBe(
      'system:keycloak-permissions-sync',
    );
    expect(result).toEqual({ activated: 0, expired: 1, failed: 0 });
  });

  it('rejects unknown permission strings', async () => {
    const { service } = createContext();

    await expect(
      service.createGrant({
        userId: 'user-1',
        permission: 'realm-admin' as AssignableKeycloakPermission,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
