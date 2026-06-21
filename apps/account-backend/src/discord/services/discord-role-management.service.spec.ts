import { HttpStatus } from '@nestjs/common';
import type { DiscordLink, DiscordRoleSetting } from '@prisma/client';
import type { Client } from 'discord.js';
import { PrismaService } from '../../prisma/prisma.service';
import { DISCORD_AUTOMATED_ROLE_IDS } from '../constants/discord-managed-roles';
import { DiscordRoleManagementService } from './discord-role-management.service';

type PrismaMock = {
  discordRoleSetting: {
    findMany: jest.Mock<Promise<DiscordRoleSetting[]>, unknown[]>;
    updateMany: jest.Mock<Promise<{ count: number }>, unknown[]>;
  };
  discordLink: {
    findFirst: jest.Mock<Promise<DiscordLink | null>, unknown[]>;
  };
};

const createdAt = new Date('2026-06-18T12:00:00.000Z');

const createRoleSetting = (
  overrides: Partial<DiscordRoleSetting> = {},
): DiscordRoleSetting => ({
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

const createDiscordLink = (
  overrides: Partial<DiscordLink> = {},
): DiscordLink => ({
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
    },
    discordLink: {
      findFirst: jest.fn<Promise<DiscordLink | null>, unknown[]>(),
    },
  };
  prisma.discordRoleSetting.updateMany.mockResolvedValue({ count: 1 });

  const service = new DiscordRoleManagementService(
    prisma as unknown as PrismaService,
  );

  return {
    prisma,
    service,
  };
};

describe('DiscordRoleManagementService', () => {
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
          roleId: { in: DISCORD_AUTOMATED_ROLE_IDS },
        },
      },
      data: { isEnabledForSelection: true },
    });
  });

  it('rejects user requests for dangerous permission roles even if they are enabled', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValue(createDiscordLink());
    prisma.discordRoleSetting.findMany.mockResolvedValue([]);

    await expect(
      service.updateUserRoles(
        'user-1',
        { selectedRoleIds: ['role-dangerous'] },
        {} as Client,
        'guild-1',
      ),
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
          roleId: { in: DISCORD_AUTOMATED_ROLE_IDS },
        },
      },
    });
  });
});
