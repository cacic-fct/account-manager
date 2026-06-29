import { Injectable, Logger, Optional } from '@nestjs/common';
import type { DiscordLink } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { Client, GuildMember } from 'discord.js';
import { UserService } from '../../auth/services/user.service';
import { UserProfile } from '../../auth/interfaces/auth.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { DiscordClientService } from './discord-client.service';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { KeycloakService } from '../../auth/services/keycloak.service';
import {
  PERMISSION_GROUP_CATALOG,
  PERMISSION_GROUP_DISCORD_ROLE_IDS,
  type PermissionGroupDefinition,
} from '@cacic/shared-types';
import {
  checkComputerScienceEnrollmentPattern,
  DISCORD_MANAGED_ROLE_IDS,
  DISCORD_REGISTRATION_ROLE,
  DiscordManagedRoleCategory,
  getDiscordManagedRoleCategory,
  getDiscordManagedRoleForUser,
} from '../constants/discord-managed-roles';

interface AssignManagedRoleOptions {
  client?: Client;
  guildId?: string;
  discordUserId?: string;
  member?: GuildMember;
  reason?: string;
  skipKeycloakHealthCheck?: boolean;
}

interface ManagedRoleAssignmentResult {
  eligibleRole: DiscordManagedRoleCategory | null;
  roleId: string | null;
  roleName: string | null;
  memberFound: boolean;
  roleApplied: boolean;
  registrationRoleApplied: boolean;
  staleRolesRemoved: number;
}

@Injectable()
export class DiscordRoleService {
  private readonly logger = new Logger(DiscordRoleService.name);
  private readonly recentManagedRoleMutationUntil = new Map<string, number>();
  private readonly managedRoleMutationTtlMs = 15_000;

  constructor(
    private readonly prisma: PrismaService,
    private userService: UserService,
    private readonly discordClientService: DiscordClientService,
    private readonly configService: ConfigService,
    private readonly keycloakService: KeycloakService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  /**
   * Check which role user is eligible for
   */
  async checkRoleEligibility(
    userId: string,
  ): Promise<DiscordManagedRoleCategory> {
    const user = await this.getUserByKeycloakId(userId);
    return getDiscordManagedRoleCategory(user, {
      skipUndergraduateUnespRoleVerification:
        await this.shouldSkipUndergraduateVerification(),
    });
  }

  /**
   * Check if user is eligible for computer science student role
   * Requires: verification completion + student role + xx12* enrollment pattern
   */
  async checkStudentEligibility(userId: string): Promise<boolean> {
    const eligibleRole = await this.checkRoleEligibility(userId);
    return eligibleRole === 'student';
  }

  /**
   * Get user by Keycloak ID
   */
  async getUserByKeycloakId(
    keycloakUserId: string,
  ): Promise<UserProfile | null> {
    try {
      return await this.userService.findByKeycloakId(keycloakUserId);
    } catch (error) {
      this.logger.error('Error getting user by Keycloak ID', error);
      return null;
    }
  }

  /**
   * Check if enrollment number matches computer science student pattern (xx12*)
   */
  checkEnrollmentPattern(enrollmentNumber?: string): boolean {
    return checkComputerScienceEnrollmentPattern(enrollmentNumber);
  }

  /**
   * Assign role to Discord user based on their linked account and verification status
   */
  async assignUserRole(
    discordLink: DiscordLink,
    options: AssignManagedRoleOptions = {},
  ): Promise<ManagedRoleAssignmentResult> {
    if (
      options.skipKeycloakHealthCheck !== true &&
      !(await this.keycloakService.isRealmReachable())
    ) {
      this.logger.warn(
        `Skipping Discord role assignment for link ${discordLink.id}: Keycloak realm health check failed`,
      );

      return {
        eligibleRole: null,
        roleId: null,
        roleName: null,
        memberFound: false,
        roleApplied: false,
        registrationRoleApplied: false,
        staleRolesRemoved: 0,
      };
    }

    const user = await this.userService.findByKeycloakId(discordLink.userId);

    if (!user) {
      this.logger.warn(
        `No user found for Discord link ${discordLink.id}; removing managed roles`,
      );

      await this.prisma.discordLink.update({
        where: { id: discordLink.id },
        data: { assignedRole: null },
      });

      const member = await this.resolveGuildMember(discordLink, options);
      if (!member) {
        return {
          eligibleRole: null,
          roleId: null,
          roleName: null,
          memberFound: false,
          roleApplied: false,
          registrationRoleApplied: false,
          staleRolesRemoved: 0,
        };
      }

      const staleRolesRemoved = await this.removeStaleManagedRoles(
        member,
        null,
        options.reason,
      );
      const registrationRoleApplied =
        await this.ensureRegistrationRoleForMember(member, options.reason);

      return {
        eligibleRole: null,
        roleId: null,
        roleName: null,
        memberFound: true,
        roleApplied: false,
        registrationRoleApplied,
        staleRolesRemoved,
      };
    }

    const role = getDiscordManagedRoleForUser(user, {
      skipUndergraduateUnespRoleVerification:
        await this.shouldSkipUndergraduateVerification(),
    });

    await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: { assignedRole: role.category },
    });

    const member = await this.resolveGuildMember(discordLink, options);
    if (!member) {
      this.logger.debug(
        `Discord member ${discordLink.discordId} not found or bot unavailable; stored intended category ${role.category}`,
      );
      return {
        eligibleRole: role.category,
        roleId: role.roleId,
        roleName: role.roleName,
        memberFound: false,
        roleApplied: false,
        registrationRoleApplied: false,
        staleRolesRemoved: 0,
      };
    }

    const staleRolesRemoved = await this.removeStaleManagedRoles(
      member,
      role.roleId,
      options.reason,
    );
    const roleApplied = await this.ensureManagedRole(
      member,
      role.roleId,
      role.roleName,
      options.reason,
    );
    let registrationRoleApplied = false;

    if (roleApplied) {
      await this.removeRegistrationRole(member, options.reason);
    } else if (this.hasNoAssignableRoles(member)) {
      registrationRoleApplied = await this.ensureRegistrationRoleForMember(
        member,
        options.reason,
      );
    }

    this.logger.log(
      `Discord managed role reconciled - User: ${discordLink.discordGlobalName}, Category: ${role.category}, Role: ${role.roleName}`,
      {
        userId: discordLink.userId,
        discordId: discordLink.discordId,
        userEmail: user?.email,
        isVerified: user?.unespRoleVerified,
        unespRole: user?.unespRole,
        enrollmentNumber: user?.enrollmentNumber,
        roleApplied,
        registrationRoleApplied,
        staleRolesRemoved,
      },
    );

    return {
      eligibleRole: role.category,
      roleId: role.roleId,
      roleName: role.roleName,
      memberFound: true,
      roleApplied,
      registrationRoleApplied,
      staleRolesRemoved,
    };
  }

  async removeManagedRolesForDiscordLink(
    discordLink: DiscordLink,
    reason = 'discord-account-unlinked',
  ): Promise<void> {
    const member = await this.resolveGuildMember(discordLink, { reason });
    if (!member) {
      await this.prisma.discordLink.update({
        where: { id: discordLink.id },
        data: { assignedRole: null },
      });
      return;
    }

    await this.removeStaleManagedRoles(member, null, reason);
    await this.ensureRegistrationRoleForMember(member, reason);
    await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: { assignedRole: null },
    });
  }

  async syncUserDiscordRoles(
    userId: string,
    reason = 'user-profile-sync',
  ): Promise<void> {
    if (!(await this.keycloakService.isRealmReachable())) {
      this.logger.warn(
        `Skipping Discord role sync for user ${userId}: Keycloak realm health check failed`,
      );
      return;
    }

    const discordLinks = await this.prisma.discordLink.findMany({
      where: { userId, deleted: false, isVerified: true },
    });

    for (const discordLink of discordLinks) {
      try {
        await this.assignUserRole(discordLink, {
          reason,
          skipKeycloakHealthCheck: true,
        });
      } catch (error) {
        this.logger.warn(
          `Failed to sync Discord role for link ${discordLink.id}:`,
          error,
        );
      }
    }
  }

  async syncAllLinkedMemberRoles(
    reason = 'discord-managed-role-sync',
  ): Promise<{ checked: number; synced: number; failed: number }> {
    const client = this.getDiscordClient();
    const guildId = this.getGuildId();

    if (!client || !guildId) {
      this.logger.debug('Skipping Discord managed role sync: bot unavailable');
      return { checked: 0, synced: 0, failed: 0 };
    }

    if (!(await this.keycloakService.isRealmReachable())) {
      this.logger.warn(
        'Skipping Discord managed role sync: Keycloak realm health check failed',
      );
      return { checked: 0, synced: 0, failed: 0 };
    }

    const discordLinks = await this.prisma.discordLink.findMany({
      where: { deleted: false, isVerified: true },
      orderBy: { createdAt: 'asc' },
    });

    let synced = 0;
    let failed = 0;

    for (const discordLink of discordLinks) {
      try {
        await this.assignUserRole(discordLink, {
          client,
          guildId,
          reason,
          skipKeycloakHealthCheck: true,
        });
        synced += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Failed to reconcile Discord role for link ${discordLink.id}:`,
          error,
        );
      }
    }

    if (discordLinks.length > 0) {
      this.logger.log(
        `Discord managed role sync completed: ${synced}/${discordLinks.length} links processed, ${failed} failed`,
      );
    }

    return { checked: discordLinks.length, synced, failed };
  }

  async syncGuildMemberRoleState(
    member: GuildMember,
    reason = 'discord-member-role-state-sync',
  ): Promise<'linked' | 'registration' | 'skipped'> {
    if (member.user.bot) {
      return 'skipped';
    }

    const discordLink = await this.prisma.discordLink.findFirst({
      where: { discordId: member.id, deleted: false, isVerified: true },
    });

    if (discordLink) {
      await this.assignUserRole(discordLink, { member, reason });
      return 'linked';
    }

    await this.removeStaleManagedRoles(member, null, reason);
    await this.ensureRegistrationRoleForMember(member, reason);
    return 'registration';
  }

  async syncAllGuildMemberRoleState(
    reason = 'discord-managed-role-hard-enforcement',
  ): Promise<{
    checked: number;
    linkedSynced: number;
    invalidLinkedCleaned: number;
    staleManagedRolesRemoved: number;
    registrationEnsured: number;
    failed: number;
  }> {
    const client = this.getDiscordClient();
    const guildId = this.getGuildId();

    if (!client || !guildId) {
      this.logger.debug(
        'Skipping Discord guild member role state sync: bot unavailable',
      );
      return {
        checked: 0,
        linkedSynced: 0,
        invalidLinkedCleaned: 0,
        staleManagedRolesRemoved: 0,
        registrationEnsured: 0,
        failed: 0,
      };
    }

    const keycloakReachable = await this.keycloakService.isRealmReachable();

    if (!keycloakReachable) {
      this.logger.warn(
        'Skipping Discord guild member role state sync: Keycloak realm health check failed',
      );
      return {
        checked: 0,
        linkedSynced: 0,
        invalidLinkedCleaned: 0,
        staleManagedRolesRemoved: 0,
        registrationEnsured: 0,
        failed: 0,
      };
    }

    const guild = await client.guilds.fetch(guildId);
    const [members, discordLinks] = await Promise.all([
      guild.members.fetch(),
      this.prisma.discordLink.findMany({
        where: { deleted: false, isVerified: true },
      }),
    ]);
    const linksByDiscordId = new Map(
      discordLinks.map((discordLink) => [discordLink.discordId, discordLink]),
    );
    const membersToReconcile = new Map<string, GuildMember>();

    for (const [, member] of members) {
      if (member.user.bot) {
        continue;
      }

      if (
        linksByDiscordId.has(member.id) ||
        this.hasManagedRoleAssigned(member)
      ) {
        membersToReconcile.set(member.id, member);
      }
    }

    let checked = 0;
    let linkedSynced = 0;
    let invalidLinkedCleaned = 0;
    let staleManagedRolesRemoved = 0;
    let registrationEnsured = 0;
    let failed = 0;

    for (const [, member] of membersToReconcile) {
      checked += 1;

      try {
        const discordLink = linksByDiscordId.get(member.id);

        if (discordLink) {
          const result = await this.assignUserRole(discordLink, {
            client,
            guildId,
            member,
            reason,
            skipKeycloakHealthCheck: true,
          });
          staleManagedRolesRemoved += result.staleRolesRemoved;
          if (result.registrationRoleApplied) {
            registrationEnsured += 1;
          }

          if (result.eligibleRole) {
            linkedSynced += 1;
          } else {
            invalidLinkedCleaned += 1;
          }
          continue;
        }

        staleManagedRolesRemoved += await this.removeStaleManagedRoles(
          member,
          null,
          reason,
        );
        const roleApplied = await this.ensureRegistrationRoleForMember(
          member,
          reason,
        );

        if (roleApplied) {
          registrationEnsured += 1;
        }
      } catch (error) {
        failed += 1;
        this.logger.warn(
          `Failed to reconcile Discord guild member ${member.id}:`,
          error,
        );
      }
    }

    this.logger.log(
      `Discord managed role hard enforcement completed: ${checked} checked, ${linkedSynced} linked synced, ${invalidLinkedCleaned} invalid linked cleaned, ${staleManagedRolesRemoved} stale roles removed, ${registrationEnsured} registration ensured, ${failed} failed`,
    );

    return {
      checked,
      linkedSynced,
      invalidLinkedCleaned,
      staleManagedRolesRemoved,
      registrationEnsured,
      failed,
    };
  }

  async reconcilePermissionGroupAffiliationRoles(
    userId: string,
    reason = 'permission-group-affiliation-sync',
  ): Promise<{ links: number; rolesAdded: number; rolesRemoved: number }> {
    const now = new Date();
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        userId,
        deletedAt: null,
        mandateStart: { lte: now },
        OR: [{ mandateEnd: null }, { mandateEnd: { gt: now } }],
      },
      select: {
        entity: true,
      },
    });
    const expectedRoleIds = new Set(
      memberships
        .map((membership) => {
          const definition = (
            PERMISSION_GROUP_CATALOG as readonly PermissionGroupDefinition[]
          ).find((definition) => definition.key === membership.entity);

          return definition?.discordRoleId;
        })
        .filter((roleId): roleId is string => !!roleId),
    );
    const discordLinks = await this.prisma.discordLink.findMany({
      where: { userId, deleted: false, isVerified: true },
    });

    let rolesAdded = 0;
    let rolesRemoved = 0;

    for (const discordLink of discordLinks) {
      const member = await this.resolveGuildMember(discordLink, { reason });
      if (!member) {
        continue;
      }

      for (const roleId of PERMISSION_GROUP_DISCORD_ROLE_IDS) {
        const shouldHaveRole = expectedRoleIds.has(roleId);
        const hasRole = member.roles.cache.has(roleId);

        if (shouldHaveRole && !hasRole) {
          if (await this.ensureManagedRole(member, roleId, roleId, reason)) {
            rolesAdded += 1;
          }
          continue;
        }

        if (!shouldHaveRole && hasRole) {
          try {
            this.markManagedRoleMutation(member);
            await member.roles.remove(roleId, reason);
            rolesRemoved += 1;
          } catch (error) {
            this.logger.warn(
              `Failed to remove Discord permission group role ${roleId} from ${member.id}:`,
              error,
            );
          }
        }
      }
    }

    return { links: discordLinks.length, rolesAdded, rolesRemoved };
  }

  hasRecentManagedRoleMutation(memberId: string): boolean {
    const mutationUntil = this.recentManagedRoleMutationUntil.get(memberId);

    if (!mutationUntil) {
      return false;
    }

    if (mutationUntil <= Date.now()) {
      this.recentManagedRoleMutationUntil.delete(memberId);
      return false;
    }

    return true;
  }

  private async resolveGuildMember(
    discordLink: DiscordLink,
    options: AssignManagedRoleOptions,
  ): Promise<GuildMember | null> {
    if (options.member) {
      return options.member;
    }

    const client = options.client ?? this.getDiscordClient();
    const guildId = options.guildId ?? this.getGuildId();

    if (!client || !guildId) {
      return null;
    }

    const discordUserId = options.discordUserId ?? discordLink.discordId;

    try {
      const guild = await client.guilds.fetch(guildId);
      return await guild.members.fetch(discordUserId);
    } catch (error) {
      this.logger.debug(
        `Discord member ${discordUserId} not available for managed role sync`,
        error instanceof Error ? error.stack : undefined,
      );
      return null;
    }
  }

  private getDiscordClient(): Client | null {
    try {
      return this.discordClientService.getClient();
    } catch {
      return null;
    }
  }

  private getGuildId(): string | null {
    return this.configService.get<string>('DISCORD_GUILD_ID') ?? null;
  }

  private async removeStaleManagedRoles(
    member: GuildMember,
    targetRoleId: string | null,
    reason?: string,
  ): Promise<number> {
    let removed = 0;

    for (const roleId of DISCORD_MANAGED_ROLE_IDS) {
      if (roleId === targetRoleId || !member.roles.cache.has(roleId)) {
        continue;
      }

      try {
        this.markManagedRoleMutation(member);
        await member.roles.remove(
          roleId,
          reason ?? 'CACiC managed role reconciliation',
        );
        removed += 1;
      } catch (error) {
        this.logger.warn(
          `Failed to remove stale Discord managed role ${roleId} from ${member.id}:`,
          error,
        );
      }
    }

    return removed;
  }

  async ensureRegistrationRoleForMember(
    member: GuildMember,
    reason?: string,
  ): Promise<boolean> {
    const role =
      member.guild.roles.cache.get(DISCORD_REGISTRATION_ROLE.roleId) ??
      (await member.guild.roles
        .fetch(DISCORD_REGISTRATION_ROLE.roleId)
        .catch(() => null));

    if (!role) {
      this.logger.warn(
        `Registration Discord role ${DISCORD_REGISTRATION_ROLE.roleName} (${DISCORD_REGISTRATION_ROLE.roleId}) not found in guild ${member.guild.id}`,
      );
      return false;
    }

    if (member.roles.cache.has(DISCORD_REGISTRATION_ROLE.roleId)) {
      return true;
    }

    try {
      this.markManagedRoleMutation(member);
      await member.roles.add(
        DISCORD_REGISTRATION_ROLE.roleId,
        reason ?? 'CACiC registration role reconciliation',
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to add Discord registration role ${DISCORD_REGISTRATION_ROLE.roleId} to ${member.id}:`,
        error,
      );
      return false;
    }
  }

  private async removeRegistrationRole(
    member: GuildMember,
    reason?: string,
  ): Promise<void> {
    if (!member.roles.cache.has(DISCORD_REGISTRATION_ROLE.roleId)) {
      return;
    }

    try {
      this.markManagedRoleMutation(member);
      await member.roles.remove(
        DISCORD_REGISTRATION_ROLE.roleId,
        reason ?? 'CACiC managed role reconciliation',
      );
    } catch (error) {
      this.logger.warn(
        `Failed to remove Discord registration role ${DISCORD_REGISTRATION_ROLE.roleId} from ${member.id}:`,
        error,
      );
    }
  }

  private async ensureManagedRole(
    member: GuildMember,
    roleId: string,
    roleName: string,
    reason?: string,
  ): Promise<boolean> {
    const role =
      member.guild.roles.cache.get(roleId) ??
      (await member.guild.roles.fetch(roleId).catch(() => null));

    if (!role) {
      this.logger.warn(
        `Managed Discord role ${roleName} (${roleId}) not found in guild ${member.guild.id}`,
      );
      return false;
    }

    if (member.roles.cache.has(roleId)) {
      return true;
    }

    try {
      this.markManagedRoleMutation(member);
      await member.roles.add(
        roleId,
        reason ?? 'CACiC managed role reconciliation',
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `Failed to add Discord managed role ${roleName} (${roleId}) to ${member.id}:`,
        error,
      );
      return false;
    }
  }

  private async shouldSkipUndergraduateVerification(): Promise<boolean> {
    return (
      (await this.featureFlags?.isUndergraduateUnespRoleVerificationDisabled()) ??
      false
    );
  }

  private hasManagedRoleAssigned(member: Pick<GuildMember, 'roles'>): boolean {
    return DISCORD_MANAGED_ROLE_IDS.some((roleId) =>
      member.roles.cache.has(roleId),
    );
  }

  private markManagedRoleMutation(member: Pick<GuildMember, 'id'>): void {
    this.recentManagedRoleMutationUntil.set(
      member.id,
      Date.now() + this.managedRoleMutationTtlMs,
    );
  }

  private hasNoAssignableRoles(member: GuildMember): boolean {
    return (
      member.roles.cache.filter((role) => role.id !== member.guild.id).size ===
      0
    );
  }
}
