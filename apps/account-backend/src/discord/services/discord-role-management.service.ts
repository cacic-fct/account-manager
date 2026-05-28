import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import type { DiscordRoleSetting } from '@prisma/client';
import { Client, Role, GuildMember } from 'discord.js';
import {
  DiscordRoleDto,
  SelectableRolesDto,
  UpdateRoleSelectionDto,
  UserRoleSelectionDto,
  UserRolesDto,
  RoleSelectionResponseDto,
} from '../dto/discord-roles.dto';
import { PrismaService } from '../../prisma/prisma.service';

type RoleSettingInput = {
  roleId: string;
  roleName: string;
  hasPermissions: boolean;
  isBlacklisted: boolean;
  roleColor: string;
  rolePosition: number;
  isEnabledForSelection: boolean;
};

@Injectable()
export class DiscordRoleManagementService {
  private readonly logger = new Logger(DiscordRoleManagementService.name);

  private readonly BLACKLISTED_ROLE_IDS: string[] = [
    '1389425145088839811',
    '533902992219570187',
    '872223819799089192',
    '1400572209403007040',
    '872238557966782574',
    '533900085642133504',
    '1400636044050960425',
    '872560793600806923',
    '1389425571003371520',
    '533901504537427968',
    '1400509075183108287',
    '1390438330835140608',
    '533902369692581909',
    '872241575336476712',
  ];

  private readonly BLACKLISTED_ROLE_NAMES = ['server booster'];

  private readonly DANGEROUS_PERMISSIONS = [
    'Administrator',
    'ManageGuild',
    'ManageRoles',
    'ManageChannels',
    'KickMembers',
    'BanMembers',
    'ManageNicknames',
    'ManageEmojisAndStickers',
    'ManageWebhooks',
    'ManageMessages',
    'MentionEveryone',
  ] as const;

  constructor(private readonly prisma: PrismaService) {}

  async syncRolesFromDiscord(client: Client, guildId: string): Promise<void> {
    try {
      const guild = await client.guilds.fetch(guildId);
      if (!guild) {
        throw new HttpException('Guild not found', HttpStatus.NOT_FOUND);
      }

      const roles = await guild.roles.fetch();

      for (const [, role] of roles) {
        if (role.name === '@everyone') continue;

        const hasPermissions = this.checkRoleHasPermissions(role);
        const isBlacklisted = this.isRoleBlacklisted(role);

        await this.upsertRoleSetting({
          roleId: role.id,
          roleName: role.name,
          hasPermissions,
          isBlacklisted,
          roleColor: role.hexColor,
          rolePosition: role.position,
          isEnabledForSelection: false,
        });
      }

      this.logger.log(
        `Synced ${roles.size} roles from Discord guild ${guild.name}`,
      );
    } catch (error) {
      this.logger.error('Error syncing roles from Discord:', error);
      throw error;
    }
  }

  async getSelectableRolesForAdmin(): Promise<SelectableRolesDto> {
    const allRoles = await this.prisma.discordRoleSetting.findMany({
      orderBy: { rolePosition: 'desc' },
    });

    if (allRoles.length === 0) {
      this.logger.warn(
        'No Discord roles found in database. Please sync roles from Discord server first.',
      );
      return {
        rolesWithPermissions: [],
        rolesWithoutPermissions: [],
        selectableRoles: [],
      };
    }

    const rolesWithPermissions = allRoles
      .filter((role) => role.hasPermissions)
      .map(this.mapToRoleDto);

    const rolesWithoutPermissions = allRoles
      .filter((role) => !role.hasPermissions)
      .map(this.mapToRoleDto);

    const selectableRoles = allRoles
      .filter((role) => role.isEnabledForSelection && !role.isBlacklisted)
      .map(this.mapToRoleDto);

    return {
      rolesWithPermissions,
      rolesWithoutPermissions,
      selectableRoles,
    };
  }

  async getSelectableRolesForUser(): Promise<DiscordRoleDto[]> {
    const roles = await this.prisma.discordRoleSetting.findMany({
      where: {
        isEnabledForSelection: true,
        isBlacklisted: false,
      },
      orderBy: { rolePosition: 'desc' },
    });

    return roles.map(this.mapToRoleDto);
  }

  async updateRoleSelection(dto: UpdateRoleSelectionDto): Promise<void> {
    this.logger.log(
      `Updating role selection with IDs: ${JSON.stringify(dto.enabledRoleIds)}`,
    );

    const allRoles = await this.prisma.discordRoleSetting.findMany();
    this.logger.log(`Found ${allRoles.length} existing role settings`);

    await this.prisma.discordRoleSetting.updateMany({
      data: { isEnabledForSelection: false },
    });

    if (dto.enabledRoleIds.length > 0) {
      await this.prisma.discordRoleSetting.updateMany({
        where: {
          roleId: { in: dto.enabledRoleIds },
          isBlacklisted: false,
        },
        data: { isEnabledForSelection: true },
      });
    }

    this.logger.log(
      `Updated role selection: ${dto.enabledRoleIds.length} roles enabled`,
    );
  }

  async getUserRoles(
    userId: string,
    client: Client,
    guildId: string,
  ): Promise<UserRolesDto> {
    try {
      const discordLink = await this.prisma.discordLink.findFirst({
        where: { userId, deleted: false, isVerified: true },
      });

      if (!discordLink) {
        throw new HttpException(
          'Discord account not linked',
          HttpStatus.BAD_REQUEST,
        );
      }

      const guild = await client.guilds.fetch(guildId);

      if (!guild) {
        throw new HttpException(
          'Discord guild not found',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      let member: GuildMember;
      try {
        member = await guild.members.fetch(discordLink.discordId);
      } catch {
        throw new HttpException(
          'User not found in Discord server. Please rejoin the server.',
          HttpStatus.BAD_REQUEST,
        );
      }

      const roleIds = Array.from(member.roles.cache.keys());
      const currentRoles = await this.prisma.discordRoleSetting.findMany({
        where: {
          roleId: { in: roleIds },
        },
      });

      const availableRoles = await this.getSelectableRolesForUser();

      return {
        currentRoles: currentRoles.map(this.mapToRoleDto),
        availableRoles,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error(
        `Error getting user roles for userId ${userId}:`,
        error,
      );
      throw new HttpException(
        'Failed to fetch user Discord roles',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  async updateUserRoles(
    userId: string,
    dto: UserRoleSelectionDto,
    client: Client,
    guildId: string,
  ): Promise<RoleSelectionResponseDto> {
    const discordLink = await this.prisma.discordLink.findFirst({
      where: { userId, deleted: false, isVerified: true },
    });

    if (!discordLink) {
      throw new HttpException(
        'Discord account not linked',
        HttpStatus.BAD_REQUEST,
      );
    }

    const selectableRoles = await this.prisma.discordRoleSetting.findMany({
      where: {
        roleId: { in: dto.selectedRoleIds },
        isEnabledForSelection: true,
        isBlacklisted: false,
      },
    });

    if (selectableRoles.length !== dto.selectedRoleIds.length) {
      throw new HttpException(
        'Some roles are not selectable',
        HttpStatus.BAD_REQUEST,
      );
    }

    const guild = await client.guilds.fetch(guildId);
    const member = await guild.members.fetch(discordLink.discordId);

    const allSelectableRoles = await this.prisma.discordRoleSetting.findMany({
      where: { isEnabledForSelection: true },
    });

    const currentSelectableRoleIds = member.roles.cache
      .filter((role) => allSelectableRoles.some((r) => r.roleId === role.id))
      .map((role) => role.id);

    const rolesToRemove = currentSelectableRoleIds.filter(
      (roleId) => !dto.selectedRoleIds.includes(roleId),
    );

    const rolesToAdd = dto.selectedRoleIds.filter(
      (roleId) => !currentSelectableRoleIds.includes(roleId),
    );

    for (const roleId of rolesToRemove) {
      try {
        await member.roles.remove(roleId);
      } catch (error) {
        this.logger.warn(
          `Failed to remove role ${roleId} from user ${userId}:`,
          error,
        );
      }
    }

    for (const roleId of rolesToAdd) {
      try {
        await member.roles.add(roleId);
      } catch (error) {
        this.logger.warn(
          `Failed to add role ${roleId} to user ${userId}:`,
          error,
        );
      }
    }

    await member.fetch(true);
    const updatedRoles = selectableRoles.filter((role) =>
      member.roles.cache.has(role.roleId),
    );

    this.logger.log(
      `Updated roles for user ${userId}: +${rolesToAdd.length} -${rolesToRemove.length}`,
    );

    return {
      message: 'Roles updated successfully',
      updatedRoles: updatedRoles.map(this.mapToRoleDto),
    };
  }

  private checkRoleHasPermissions(role: Role): boolean {
    return this.DANGEROUS_PERMISSIONS.some((permission) => {
      try {
        return role.permissions.has(permission);
      } catch {
        return false;
      }
    });
  }

  private isRoleBlacklisted(role: Role): boolean {
    if (this.BLACKLISTED_ROLE_IDS.includes(role.id)) {
      return true;
    }

    const roleName = role.name.toLowerCase();
    return this.BLACKLISTED_ROLE_NAMES.some((blacklistedName) =>
      roleName.includes(blacklistedName.toLowerCase()),
    );
  }

  private async upsertRoleSetting(data: RoleSettingInput): Promise<void> {
    await this.prisma.discordRoleSetting.upsert({
      where: { roleId: data.roleId },
      update: {
        roleName: data.roleName,
        hasPermissions: data.hasPermissions,
        isBlacklisted: data.isBlacklisted,
        roleColor: data.roleColor,
        rolePosition: data.rolePosition,
      },
      create: data,
    });
  }

  private mapToRoleDto = (roleSetting: DiscordRoleSetting): DiscordRoleDto => ({
    id: roleSetting.roleId,
    name: roleSetting.roleName,
    color: roleSetting.roleColor || '#000000',
    position: roleSetting.rolePosition,
    hasPermissions: roleSetting.hasPermissions,
    isBlacklisted: roleSetting.isBlacklisted,
    isEnabled: roleSetting.isEnabledForSelection,
    isManaged: false,
  });
}
