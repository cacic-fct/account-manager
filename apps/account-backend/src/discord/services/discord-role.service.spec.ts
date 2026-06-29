import type { DiscordLink } from '@prisma/client';
import type { Client, GuildMember, Role } from 'discord.js';
import { ConfigService } from '@nestjs/config';
import {
  PERMISSION_GROUP_DISCORD_ROLE_IDS,
  PermissionGroupKey,
  UnespRole,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { UserService } from '../../auth/services/user.service';
import { UserProfile } from '../../auth/interfaces/auth.interface';
import { DiscordClientService } from './discord-client.service';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { KeycloakService } from '../../auth/services/keycloak.service';
import {
  DISCORD_MANAGED_ROLES,
  DISCORD_REGISTRATION_ROLE,
} from '../constants/discord-managed-roles';
import { DiscordRoleService } from './discord-role.service';

type PrismaMock = {
  discordLink: {
    findMany: jest.Mock<Promise<DiscordLink[]>, unknown[]>;
    update: jest.Mock<Promise<DiscordLink>, unknown[]>;
  };
  studentEntityMembership: {
    findMany: jest.Mock<Promise<{ entity: string }[]>, unknown[]>;
  };
};

type UserServiceMock = {
  findByKeycloakId: jest.Mock<Promise<UserProfile | null>, [string]>;
};

type DiscordClientServiceMock = {
  getClient: jest.Mock<Client, []>;
};

type ConfigServiceMock = {
  get: jest.Mock<string | undefined, [string]>;
};

type FeatureFlagServiceMock = {
  isUndergraduateUnespRoleVerificationDisabled: jest.Mock<Promise<boolean>, []>;
};

type KeycloakServiceMock = {
  isRealmReachable: jest.Mock<Promise<boolean>, []>;
};

type MockMember = {
  member: GuildMember;
  roleIds: Set<string>;
  add: jest.Mock<Promise<void>, [string, string | undefined]>;
  remove: jest.Mock<Promise<void>, [string, string | undefined]>;
};

const createdAt = new Date('2026-06-23T12:00:00.000Z');

const createDiscordLink = (
  overrides: Partial<DiscordLink> = {},
): DiscordLink => ({
  id: '00000000-0000-7000-8000-000000000001',
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

const createUser = (overrides: Partial<UserProfile> = {}): UserProfile => ({
  id: 'account-user-1',
  username: 'student',
  email: 'student@unesp.br',
  secondaryEmails: [],
  fullname: 'Student User',
  displayName: 'Student',
  phone: '',
  enrollmentNumber: '221234',
  identityDocument: '123456789',
  isForeigner: false,
  isOnboarded: true,
  unespRole: UnespRole.ALUNO_GRADUACAO,
  unespRoleVerified: true,
  externalUserVerified: false,
  fullNameLocked: false,
  keycloakId: 'user-1',
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createRole = (roleId: string): Role => ({ id: roleId }) as Role;

const createMember = (
  memberId: string,
  initialRoleIds: readonly string[],
): MockMember => {
  const roleIds = new Set(initialRoleIds);
  const add = jest
    .fn<Promise<void>, [string, string | undefined]>()
    .mockImplementation((roleId) => {
      roleIds.add(roleId);
      return Promise.resolve();
    });
  const remove = jest
    .fn<Promise<void>, [string, string | undefined]>()
    .mockImplementation((roleId) => {
      roleIds.delete(roleId);
      return Promise.resolve();
    });
  const roles = {
    add,
    remove,
    cache: {
      has: (roleId: string) => roleIds.has(roleId),
      filter: (predicate: (role: Role) => boolean) => ({
        size: Array.from(roleIds)
          .map((roleId) => createRole(roleId))
          .filter(predicate).length,
      }),
    },
  };
  const guildRoles = {
    cache: {
      get: jest.fn<Role, [string]>((roleId) => createRole(roleId)),
    },
    fetch: jest.fn<Promise<Role | null>, [string]>((roleId) =>
      Promise.resolve(createRole(roleId)),
    ),
  };
  const member = {
    id: memberId,
    user: { bot: false },
    roles,
    guild: {
      id: 'guild-1',
      roles: guildRoles,
    },
  } as unknown as GuildMember;

  return { member, roleIds, add, remove };
};

const createContext = (members: readonly GuildMember[]) => {
  const guildMembers = new Map(members.map((member) => [member.id, member]));
  const guild = {
    members: {
      fetch: jest
        .fn<Promise<Map<string, GuildMember> | GuildMember>, [string?]>()
        .mockImplementation((memberId?: string) =>
          Promise.resolve(
            memberId
              ? (guildMembers.get(memberId) as GuildMember)
              : guildMembers,
          ),
        ),
    },
  };
  const client = {
    guilds: {
      fetch: jest
        .fn<Promise<typeof guild>, [string]>()
        .mockResolvedValue(guild),
    },
  } as unknown as Client;
  const prisma: PrismaMock = {
    discordLink: {
      findMany: jest.fn<Promise<DiscordLink[]>, unknown[]>(),
      update: jest.fn<Promise<DiscordLink>, unknown[]>(),
    },
    studentEntityMembership: {
      findMany: jest.fn<Promise<{ entity: string }[]>, unknown[]>(),
    },
  };
  const userService: UserServiceMock = {
    findByKeycloakId: jest.fn<Promise<UserProfile | null>, [string]>(),
  };
  const discordClientService: DiscordClientServiceMock = {
    getClient: jest.fn<Client, []>().mockReturnValue(client),
  };
  const configService: ConfigServiceMock = {
    get: jest.fn<string | undefined, [string]>((key) =>
      key === 'DISCORD_GUILD_ID' ? 'guild-1' : undefined,
    ),
  };
  const featureFlags: FeatureFlagServiceMock = {
    isUndergraduateUnespRoleVerificationDisabled: jest
      .fn<Promise<boolean>, []>()
      .mockResolvedValue(false),
  };
  const keycloakService: KeycloakServiceMock = {
    isRealmReachable: jest.fn<Promise<boolean>, []>().mockResolvedValue(true),
  };
  const service = new DiscordRoleService(
    prisma as unknown as PrismaService,
    userService as unknown as UserService,
    discordClientService as unknown as DiscordClientService,
    configService as unknown as ConfigService,
    keycloakService as unknown as KeycloakService,
    featureFlags as unknown as FeatureFlagService,
  );

  prisma.discordLink.update.mockResolvedValue(createDiscordLink());
  prisma.studentEntityMembership.findMany.mockResolvedValue([]);

  return {
    prisma,
    userService,
    keycloakService,
    service,
  };
};

describe('DiscordRoleService managed-role enforcement', () => {
  it('removes app-managed roles from unlinked members and ignores unrelated members', async () => {
    const staleMember = createMember('discord-stale', [
      DISCORD_MANAGED_ROLES.student.roleId,
    ]);
    const unrelatedMember = createMember('discord-unrelated', []);
    const { prisma, service } = createContext([
      staleMember.member,
      unrelatedMember.member,
    ]);
    prisma.discordLink.findMany.mockResolvedValue([]);

    await expect(
      service.syncAllGuildMemberRoleState('test-hard-enforcement'),
    ).resolves.toEqual({
      checked: 1,
      linkedSynced: 0,
      invalidLinkedCleaned: 0,
      staleManagedRolesRemoved: 1,
      registrationEnsured: 1,
      failed: 0,
    });
    expect(staleMember.remove).toHaveBeenCalledWith(
      DISCORD_MANAGED_ROLES.student.roleId,
      'test-hard-enforcement',
    );
    expect(staleMember.add).toHaveBeenCalledWith(
      DISCORD_REGISTRATION_ROLE.roleId,
      'test-hard-enforcement',
    );
    expect(unrelatedMember.add).not.toHaveBeenCalled();
    expect(unrelatedMember.remove).not.toHaveBeenCalled();
  });

  it('reconciles verified linked members to their current eligible managed role', async () => {
    const linkedMember = createMember('discord-1', [
      DISCORD_MANAGED_ROLES.unesp.roleId,
      DISCORD_REGISTRATION_ROLE.roleId,
    ]);
    const { prisma, service, userService } = createContext([
      linkedMember.member,
    ]);
    prisma.discordLink.findMany.mockResolvedValue([createDiscordLink()]);
    userService.findByKeycloakId.mockResolvedValue(createUser());

    await expect(
      service.syncAllGuildMemberRoleState('test-hard-enforcement'),
    ).resolves.toEqual({
      checked: 1,
      linkedSynced: 1,
      invalidLinkedCleaned: 0,
      staleManagedRolesRemoved: 1,
      registrationEnsured: 0,
      failed: 0,
    });
    expect(linkedMember.remove).toHaveBeenCalledWith(
      DISCORD_MANAGED_ROLES.unesp.roleId,
      'test-hard-enforcement',
    );
    expect(linkedMember.add).toHaveBeenCalledWith(
      DISCORD_MANAGED_ROLES.student.roleId,
      'test-hard-enforcement',
    );
    expect(linkedMember.remove).toHaveBeenCalledWith(
      DISCORD_REGISTRATION_ROLE.roleId,
      'test-hard-enforcement',
    );
    expect(prisma.discordLink.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-7000-8000-000000000001' },
      data: { assignedRole: 'student' },
    });
    expect(service.hasRecentManagedRoleMutation('discord-1')).toBe(true);
  });

  it('cleans verified links whose local account no longer exists instead of assigning visitor', async () => {
    const linkedMember = createMember('discord-1', [
      DISCORD_MANAGED_ROLES.visitor.roleId,
    ]);
    const { prisma, service, userService } = createContext([
      linkedMember.member,
    ]);
    prisma.discordLink.findMany.mockResolvedValue([createDiscordLink()]);
    userService.findByKeycloakId.mockResolvedValue(null);

    await expect(
      service.syncAllGuildMemberRoleState('test-hard-enforcement'),
    ).resolves.toEqual({
      checked: 1,
      linkedSynced: 0,
      invalidLinkedCleaned: 1,
      staleManagedRolesRemoved: 1,
      registrationEnsured: 1,
      failed: 0,
    });
    expect(prisma.discordLink.update).toHaveBeenCalledWith({
      where: { id: '00000000-0000-7000-8000-000000000001' },
      data: { assignedRole: null },
    });
    expect(linkedMember.remove).toHaveBeenCalledWith(
      DISCORD_MANAGED_ROLES.visitor.roleId,
      'test-hard-enforcement',
    );
    expect(linkedMember.add).toHaveBeenCalledWith(
      DISCORD_REGISTRATION_ROLE.roleId,
      'test-hard-enforcement',
    );
  });

  it('keeps active permission-group roles while cleaning links whose local account no longer exists', async () => {
    const groupRoleId = PERMISSION_GROUP_DISCORD_ROLE_IDS[0];
    if (!groupRoleId) {
      throw new Error('Expected at least one permission group Discord role.');
    }
    const linkedMember = createMember('discord-1', [
      DISCORD_MANAGED_ROLES.visitor.roleId,
      groupRoleId,
    ]);
    const { prisma, service, userService } = createContext([
      linkedMember.member,
    ]);
    prisma.discordLink.findMany.mockResolvedValue([createDiscordLink()]);
    prisma.studentEntityMembership.findMany.mockResolvedValue([
      { entity: PermissionGroupKey.Cacic },
    ]);
    userService.findByKeycloakId.mockResolvedValue(null);

    await expect(
      service.syncAllGuildMemberRoleState('test-hard-enforcement'),
    ).resolves.toEqual({
      checked: 1,
      linkedSynced: 0,
      invalidLinkedCleaned: 1,
      staleManagedRolesRemoved: 1,
      registrationEnsured: 1,
      failed: 0,
    });

    expect(linkedMember.remove).toHaveBeenCalledWith(
      DISCORD_MANAGED_ROLES.visitor.roleId,
      'test-hard-enforcement',
    );
    expect(linkedMember.remove).not.toHaveBeenCalledWith(
      groupRoleId,
      'test-hard-enforcement',
    );
  });

  it('does not mutate Discord roles when assigning while Keycloak is unreachable', async () => {
    const linkedMember = createMember('discord-1', [
      DISCORD_MANAGED_ROLES.unesp.roleId,
    ]);
    const { prisma, service, userService, keycloakService } = createContext([
      linkedMember.member,
    ]);
    keycloakService.isRealmReachable.mockResolvedValue(false);

    await expect(
      service.assignUserRole(createDiscordLink(), {
        member: linkedMember.member,
        reason: 'test-linked-sync',
      }),
    ).resolves.toEqual({
      eligibleRole: null,
      roleId: null,
      roleName: null,
      memberFound: false,
      roleApplied: false,
      registrationRoleApplied: false,
      staleRolesRemoved: 0,
    });
    expect(userService.findByKeycloakId).not.toHaveBeenCalled();
    expect(prisma.discordLink.update).not.toHaveBeenCalled();
    expect(linkedMember.remove).not.toHaveBeenCalled();
    expect(linkedMember.add).not.toHaveBeenCalled();
    expect(service.hasRecentManagedRoleMutation('discord-1')).toBe(false);
  });

  it('skips destructive guild enforcement while Keycloak is unreachable', async () => {
    const linkedMember = createMember('discord-1', [
      DISCORD_MANAGED_ROLES.visitor.roleId,
    ]);
    const { prisma, service, keycloakService } = createContext([
      linkedMember.member,
    ]);
    keycloakService.isRealmReachable.mockResolvedValue(false);
    prisma.discordLink.findMany.mockResolvedValue([createDiscordLink()]);

    await expect(
      service.syncAllGuildMemberRoleState('test-hard-enforcement'),
    ).resolves.toEqual({
      checked: 0,
      linkedSynced: 0,
      invalidLinkedCleaned: 0,
      staleManagedRolesRemoved: 0,
      registrationEnsured: 0,
      failed: 0,
    });
    expect(prisma.discordLink.findMany).not.toHaveBeenCalled();
    expect(prisma.discordLink.update).not.toHaveBeenCalled();
    expect(linkedMember.remove).not.toHaveBeenCalled();
    expect(linkedMember.add).not.toHaveBeenCalled();
  });
});
