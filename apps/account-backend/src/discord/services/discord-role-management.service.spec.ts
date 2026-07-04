import { HttpStatus } from '@nestjs/common';
import type { DiscordLink, DiscordRoleSetting } from '@prisma/client';
import type { Client } from 'discord.js';
import { PERMISSION_GROUP_DISCORD_ROLE_IDS } from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { DISCORD_AUTOMATED_ROLE_IDS } from '../constants/discord-managed-roles';
import { DiscordRoleManagementService } from './discord-role-management.service';

const AUTOMATED_ROLE_IDS = [...DISCORD_AUTOMATED_ROLE_IDS, ...PERMISSION_GROUP_DISCORD_ROLE_IDS];

type PrismaMock = {
  discordRoleSetting: {
    findMany: jest.Mock<Promise<DiscordRoleSetting[]>, unknown[]>;
    updateMany: jest.Mock<Promise<{ count: number }>, unknown[]>;
    upsert: jest.Mock<Promise<DiscordRoleSetting>, unknown[]>;
  };
  discordLink: {
    findFirst: jest.Mock<Promise<DiscordLink | null>, unknown[]>;
  };
};

type RoleUpsertArgs = {
  create: {
    roleId: string;
    hasPermissions: boolean;
    isBlacklisted: boolean;
  };
};

const createdAt = new Date('2026-06-18T12:00:00.000Z');

const createRoleSetting = (overrides: Partial<DiscordRoleSetting> = {}): DiscordRoleSetting => ({
  id: '00000000-0000-7000-8000-000000000001',
  roleId: 'role-safe',
  roleName: 'Safe Role',
  isEnabledForSelection: false,
  isBlacklisted: false,
  hasPermissions: false,
  roleColor: '#5865f2',
  rolePosition: 1,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createDiscordLink = (overrides: Partial<DiscordLink> = {}): DiscordLink => ({
  id: '00000000-0000-7000-8000-000000000002',
  userId: 'user-1',
  discordId: 'discord-1',
  discordUsername: 'discord-user',
  discordGlobalName: 'Discord User',
  discordAvatarHash: null,
  isVerified: true,
  serverInviteUsed: null,
  assignedRole: null,
  deleted: false,
  deletedAt: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createContext = () => {
  const prisma: PrismaMock = {
    discordRoleSetting: {
      findMany: jest.fn<Promise<DiscordRoleSetting[]>, unknown[]>(),
      updateMany: jest.fn<Promise<{ count: number }>, unknown[]>(),
      upsert: jest.fn<Promise<DiscordRoleSetting>, unknown[]>(),
    },
    discordLink: {
      findFirst: jest.fn<Promise<DiscordLink | null>, unknown[]>(),
    },
  };
  prisma.discordRoleSetting.updateMany.mockResolvedValue({ count: 1 });
  prisma.discordRoleSetting.upsert.mockResolvedValue(createRoleSetting());

  const service = new DiscordRoleManagementService(prisma as unknown as PrismaService);

  return {
    prisma,
    service,
  };
};

describe('DiscordRoleManagementService', () => {
  const createClient = (guild: unknown): Client =>
    ({
      guilds: {
        fetch: jest.fn<Promise<unknown>, [string]>().mockResolvedValue(guild),
      },
    }) as unknown as Client;

  const createRole = (
    overrides: {
      id?: string;
      name?: string;
      permissionResult?: boolean;
      permissionThrows?: boolean;
      hexColor?: string;
      position?: number;
    } = {},
  ) => ({
    id: overrides.id ?? 'role-safe',
    name: overrides.name ?? 'Safe Role',
    hexColor: overrides.hexColor ?? '#5865f2',
    position: overrides.position ?? 1,
    permissions: {
      has: jest.fn<boolean, [string]>(() => {
        if (overrides.permissionThrows) {
          throw new Error('unknown permission');
        }
        return overrides.permissionResult ?? false;
      }),
    },
  });

  it('syncs Discord roles and flags dangerous or blacklisted roles', async () => {
    const { prisma, service } = createContext();
    const roles = new Map<string, unknown>([
      ['everyone', createRole({ id: 'everyone', name: '@everyone' })],
      ['safe', createRole()],
      [
        'dangerous',
        createRole({
          id: 'role-dangerous',
          name: 'Dangerous Role',
          permissionResult: true,
          position: 2,
        }),
      ],
      [
        'managed',
        createRole({
          id: DISCORD_AUTOMATED_ROLE_IDS[0],
          name: 'Managed Automated Role',
          position: 4,
        }),
      ],
      [
        'booster',
        createRole({
          id: 'role-booster',
          name: 'Server Booster',
          permissionThrows: true,
          position: 3,
        }),
      ],
    ]);
    const guild = {
      name: 'CACiC',
      roles: {
        fetch: jest.fn<Promise<Map<string, unknown>>, []>().mockResolvedValue(roles),
      },
    };

    await service.syncRolesFromDiscord(createClient(guild), 'guild-1');

    expect(prisma.discordRoleSetting.upsert).toHaveBeenCalledTimes(4);
    const dangerousRoleUpsert = prisma.discordRoleSetting.upsert.mock.calls[1][0] as RoleUpsertArgs;
    const managedRoleUpsert = prisma.discordRoleSetting.upsert.mock.calls[2][0] as RoleUpsertArgs;
    const boosterRoleUpsert = prisma.discordRoleSetting.upsert.mock.calls[3][0] as RoleUpsertArgs;
    expect(dangerousRoleUpsert.create.roleId).toBe('role-dangerous');
    expect(dangerousRoleUpsert.create.hasPermissions).toBe(true);
    expect(managedRoleUpsert.create.roleId).toBe(DISCORD_AUTOMATED_ROLE_IDS[0]);
    expect(managedRoleUpsert.create.isBlacklisted).toBe(true);
    expect(boosterRoleUpsert.create.roleId).toBe('role-booster');
    expect(boosterRoleUpsert.create.isBlacklisted).toBe(true);
  });

  it('propagates sync failures when the guild cannot be fetched', async () => {
    const { service } = createContext();

    await expect(service.syncRolesFromDiscord(createClient(null), 'guild-1')).rejects.toMatchObject({
      response: 'Guild not found',
      status: HttpStatus.NOT_FOUND,
    });
  });

  it('returns empty admin role groups when Discord roles have not been synced', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([]);

    await expect(service.getSelectableRolesForAdmin()).resolves.toEqual({
      rolesWithPermissions: [],
      rolesWithoutPermissions: [],
      selectableRoles: [],
    });
  });

  it('groups admin selectable roles and hides blacklisted managed roles', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([
      createRoleSetting({ roleId: 'role-safe', isEnabledForSelection: true }),
      createRoleSetting({
        roleId: 'role-dangerous',
        roleName: 'Dangerous Role',
        hasPermissions: true,
        isEnabledForSelection: true,
      }),
      createRoleSetting({
        roleId: DISCORD_AUTOMATED_ROLE_IDS[0],
        roleName: 'Managed Role',
        isEnabledForSelection: true,
      }),
    ]);

    const result = await service.getSelectableRolesForAdmin();

    expect(result.rolesWithPermissions).toHaveLength(1);
    expect(result.rolesWithoutPermissions).toHaveLength(2);
    expect(result.selectableRoles).toEqual([expect.objectContaining({ id: 'role-safe', isManaged: false })]);
  });

  it('returns selectable user roles ordered by the database query', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([
      createRoleSetting({
        roleColor: '',
        isEnabledForSelection: true,
      }),
    ]);

    await expect(service.getSelectableRolesForUser()).resolves.toEqual([
      expect.objectContaining({
        id: 'role-safe',
        color: '#000000',
        isEnabled: true,
      }),
    ]);
  });

  it('rejects dangerous permission roles when updating admin selection', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([
      createRoleSetting(),
      createRoleSetting({
        roleId: 'role-dangerous',
        roleName: 'Admin Role',
        hasPermissions: true,
      }),
    ]);

    await expect(
      service.updateRoleSelection({
        enabledRoleIds: ['role-safe', 'role-dangerous'],
      }),
    ).rejects.toMatchObject({
      response: 'Some roles are not selectable: Admin Role',
      status: HttpStatus.BAD_REQUEST,
    });

    expect(prisma.discordRoleSetting.updateMany).not.toHaveBeenCalled();
  });

  it('only enables non-dangerous roles for selection', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([createRoleSetting()]);

    await service.updateRoleSelection({
      enabledRoleIds: ['role-safe'],
    });

    expect(prisma.discordRoleSetting.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.discordRoleSetting.updateMany).toHaveBeenLastCalledWith({
      where: {
        roleId: { in: ['role-safe'] },
        isBlacklisted: false,
        hasPermissions: false,
        NOT: {
          roleId: { in: AUTOMATED_ROLE_IDS },
        },
      },
      data: { isEnabledForSelection: true },
    });
  });

  it('rejects unknown role ids when updating admin selection', async () => {
    const { prisma, service } = createContext();
    prisma.discordRoleSetting.findMany.mockResolvedValue([createRoleSetting()]);

    await expect(
      service.updateRoleSelection({
        enabledRoleIds: ['missing-role'],
      }),
    ).rejects.toMatchObject({
      response: 'Some roles are not selectable: missing-role',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('rejects user requests for dangerous permission roles even if they are enabled', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValue(createDiscordLink());
    prisma.discordRoleSetting.findMany.mockResolvedValue([]);

    await expect(
      service.updateUserRoles('user-1', { selectedRoleIds: ['role-dangerous'] }, {} as Client, 'guild-1'),
    ).rejects.toMatchObject({
      response: 'Some roles are not selectable',
      status: HttpStatus.BAD_REQUEST,
    });

    expect(prisma.discordRoleSetting.findMany).toHaveBeenCalledWith({
      where: {
        roleId: { in: ['role-dangerous'] },
        isEnabledForSelection: true,
        isBlacklisted: false,
        hasPermissions: false,
        NOT: {
          roleId: { in: AUTOMATED_ROLE_IDS },
        },
      },
    });
  });

  it('requires a linked Discord account before updating user roles', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValue(null);

    await expect(
      service.updateUserRoles('user-1', { selectedRoleIds: [] }, createClient({}), 'guild-1'),
    ).rejects.toMatchObject({
      response: 'Discord account not linked',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('returns current and available roles for a linked Discord user', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValue(createDiscordLink());
    prisma.discordRoleSetting.findMany
      .mockResolvedValueOnce([createRoleSetting()])
      .mockResolvedValueOnce([createRoleSetting({ roleId: 'role-new', roleName: 'New Role' })]);
    const guild = {
      members: {
        fetch: jest.fn<Promise<unknown>, [string]>().mockResolvedValue({
          roles: {
            cache: {
              keys: () => ['role-safe'].values(),
            },
          },
        }),
      },
    };

    await expect(service.getUserRoles('user-1', createClient(guild), 'guild-1')).resolves.toEqual({
      currentRoles: [expect.objectContaining({ id: 'role-safe' })],
      availableRoles: [expect.objectContaining({ id: 'role-new' })],
    });
  });

  it('rejects user role reads when the Discord account or guild member is missing', async () => {
    const { prisma, service } = createContext();

    await expect(service.getUserRoles('user-1', createClient({}), 'guild-1')).rejects.toMatchObject({
      response: 'Discord account not linked',
      status: HttpStatus.BAD_REQUEST,
    });

    prisma.discordLink.findFirst.mockResolvedValue(createDiscordLink());
    await expect(service.getUserRoles('user-1', createClient(null), 'guild-1')).rejects.toMatchObject({
      response: 'Discord guild not found',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });

    await expect(
      service.getUserRoles(
        'user-1',
        createClient({
          members: {
            fetch: jest.fn<Promise<unknown>, [string]>().mockRejectedValue(new Error('missing')),
          },
        }),
        'guild-1',
      ),
    ).rejects.toMatchObject({
      response: 'User not found in Discord server. Please rejoin the server.',
      status: HttpStatus.BAD_REQUEST,
    });
  });

  it('wraps unexpected user role read failures', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockRejectedValue(new Error('database down'));

    await expect(service.getUserRoles('user-1', createClient({}), 'guild-1')).rejects.toMatchObject({
      response: 'Failed to fetch user Discord roles',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
    });
  });

  it('updates user role selections and tolerates individual Discord add/remove failures', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValue(createDiscordLink());
    prisma.discordRoleSetting.findMany
      .mockResolvedValueOnce([createRoleSetting({ roleId: 'role-new', roleName: 'New Role' })])
      .mockResolvedValueOnce([
        createRoleSetting({ roleId: 'role-old', roleName: 'Old Role' }),
        createRoleSetting({ roleId: 'role-new', roleName: 'New Role' }),
      ]);

    const remove = jest.fn<Promise<void>, [string, string | undefined]>().mockRejectedValue(new Error('cannot remove'));
    const add = jest.fn<Promise<void>, [string, string | undefined]>().mockRejectedValue(new Error('cannot add'));
    let hasRole: (roleId: string) => boolean = (roleId: string) => roleId === 'role-old';
    const fetch = jest.fn<Promise<void>, [boolean]>().mockImplementation(() => {
      hasRole = (roleId: string) => roleId === 'role-new';
      return Promise.resolve();
    });
    const member = {
      roles: {
        remove,
        add,
        cache: {
          filter: (predicate: (role: { id: string }) => boolean) => ({
            map: (mapper: (role: { id: string }) => string) =>
              [{ id: 'role-old' }, { id: 'unselectable-role' }].filter(predicate).map(mapper),
          }),
          has: (roleId: string) => hasRole(roleId),
        },
      },
      fetch,
    };
    const guild = {
      members: {
        fetch: jest.fn<Promise<typeof member>, [string]>().mockResolvedValue(member),
      },
    };

    await expect(
      service.updateUserRoles('user-1', { selectedRoleIds: ['role-new'] }, createClient(guild), 'guild-1'),
    ).resolves.toEqual({
      message: 'Roles updated successfully',
      updatedRoles: [expect.objectContaining({ id: 'role-new' })],
    });
    expect(remove).toHaveBeenCalledWith('role-old', 'CACiC self-service role selection by account user-1');
    expect(add).toHaveBeenCalledWith('role-new', 'CACiC self-service role selection by account user-1');
    expect(fetch).toHaveBeenCalledWith(true);
  });
});
