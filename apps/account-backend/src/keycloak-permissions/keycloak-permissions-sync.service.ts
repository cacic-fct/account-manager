import { PermissionGroupKey, KeycloakPermissionSyncResult } from '@cacic/shared-types';
import { Injectable, Logger } from '@nestjs/common';
import { KeycloakService } from '../auth/services/keycloak.service';
import { DiscordRoleService } from '../discord/services/discord-role.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getPermissionGroupDefinition,
  isGrantActive,
  isGrantExpired,
  isGroupRoleGrantActive,
  isGroupRoleGrantExpired,
  isMembershipActive,
  isMembershipExpired,
  isDbManagedRole,
} from './keycloak-permissions.helpers';
import {
  DB_MANAGED_ROLE_FILTER,
  GRANT_SELECT,
  GROUP_ROLE_GRANT_SELECT,
  MEMBERSHIP_SELECT,
  SYNC_ACTOR_ID,
  type GrantRecord,
  type GroupRoleGrantRecord,
  type MembershipRecord,
} from './keycloak-permissions.records';

@Injectable()
export class KeycloakPermissionsSyncService {
  private readonly logger = new Logger(KeycloakPermissionsSyncService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly discordRoleService: DiscordRoleService,
  ) {}

  async synchronizePermissionGrants(): Promise<KeycloakPermissionSyncResult> {
    const [directResult, groupResult] = await Promise.all([
      this.synchronizeDirectPermissionGrants(),
      this.synchronizeGroupPermissionGrants(),
    ]);

    return {
      activated: directResult.activated + groupResult.activated,
      expired: directResult.expired + groupResult.expired,
      failed: directResult.failed + groupResult.failed,
    };
  }

  async synchronizeStudentEntityMemberships(): Promise<KeycloakPermissionSyncResult> {
    const now = new Date();
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        deletedAt: null,
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [{ mandateEnd: 'asc' }, { mandateStart: 'asc' }],
    });
    const result: KeycloakPermissionSyncResult = {
      activated: 0,
      expired: 0,
      failed: 0,
    };

    for (const membership of memberships) {
      try {
        if (isMembershipExpired(membership, now)) {
          await this.expireMembership(membership, now);
          result.expired += 1;
          continue;
        }

        if (isMembershipActive(membership, now)) {
          await this.activateMembership(membership, now);
          result.activated += 1;
        }
      } catch (error) {
        result.failed += 1;
        await this.recordMembershipSyncFailure(membership.id, error);
      }
    }

    return result;
  }

  async syncGrantAfterWrite(
    grant: GrantRecord,
    options: {
      removeIfPreviouslyActive?: boolean;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<void> {
    const now = new Date();
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    try {
      if (isGrantActive(grant, now)) {
        await this.activateGrant(grant, now);
        return;
      }

      if (options.removeIfPreviouslyActive) {
        await this.keycloakService.removeUserClientRoles(grant.userId, [grant.roleName], grant.clientId);
        await this.markSynced(grant.id, now);
      }
    } catch (error) {
      await this.recordSyncFailure(grant.id, error);
      if (options.throwOnFailure ?? true) {
        throw error;
      }
    }
  }

  async syncGroupRoleGrantAfterWrite(
    grant: GroupRoleGrantRecord,
    options: {
      removeIfPreviouslyActive?: boolean;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<void> {
    const now = new Date();
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    try {
      if (isGroupRoleGrantActive(grant, now)) {
        await this.activateGroupRoleGrant(grant, now);
        return;
      }

      if (options.removeIfPreviouslyActive) {
        await this.keycloakService.removeGroupClientRoles(grant.keycloakGroupId, [grant.roleName], grant.clientId);
        await this.markGroupRoleSynced(grant.id, now);
      }
    } catch (error) {
      await this.recordGroupRoleSyncFailure(grant.id, error);
      if (options.throwOnFailure ?? true) {
        throw error;
      }
    }
  }

  async syncMembershipAfterWrite(
    membership: MembershipRecord,
    options: {
      deactivateLinkedGrants?: boolean;
      removeIfPreviouslyActive?: boolean;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<void> {
    const now = new Date();

    try {
      if (isMembershipActive(membership, now)) {
        await this.activateMembership(membership, now);
        return;
      }

      if (options.removeIfPreviouslyActive) {
        const group = getPermissionGroupDefinition(membership.entity as PermissionGroupKey);
        await this.keycloakService.removeUserFromGroupId(
          membership.userId,
          group.keycloakGroupId,
          group.keycloakGroupPath,
        );
        if (options.deactivateLinkedGrants ?? true) {
          await this.deactivateLinkedPermissionGrants(membership, now);
        }
        await this.markMembershipSynced(membership.id, now);
      }
    } catch (error) {
      await this.recordMembershipSyncFailure(membership.id, error);
      if (options.throwOnFailure ?? true) {
        throw error;
      }
    }
  }

  private async synchronizeDirectPermissionGrants(): Promise<KeycloakPermissionSyncResult> {
    const now = new Date();
    const grants = await this.prisma.keycloakPermissionGrant.findMany({
      where: {
        deletedAt: null,
        studentEntityMembershipId: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: GRANT_SELECT,
      orderBy: [{ validUntil: 'asc' }, { validFrom: 'asc' }],
    });
    const result: KeycloakPermissionSyncResult = {
      activated: 0,
      expired: 0,
      failed: 0,
    };

    for (const grant of grants) {
      try {
        if (isGrantExpired(grant, now)) {
          await this.expireGrant(grant, now);
          result.expired += 1;
          continue;
        }

        if (isGrantActive(grant, now)) {
          await this.activateGrant(grant, now);
          result.activated += 1;
        }
      } catch (error) {
        result.failed += 1;
        await this.recordSyncFailure(grant.id, error);
      }
    }

    return result;
  }

  private async synchronizeGroupPermissionGrants(): Promise<KeycloakPermissionSyncResult> {
    const now = new Date();
    const grants = await this.prisma.keycloakGroupPermissionGrant.findMany({
      where: {
        deletedAt: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: GROUP_ROLE_GRANT_SELECT,
      orderBy: [{ validUntil: 'asc' }, { validFrom: 'asc' }],
    });
    const result: KeycloakPermissionSyncResult = {
      activated: 0,
      expired: 0,
      failed: 0,
    };

    for (const grant of grants) {
      try {
        if (isGroupRoleGrantExpired(grant, now)) {
          await this.expireGroupRoleGrant(grant, now);
          result.expired += 1;
          continue;
        }

        if (isGroupRoleGrantActive(grant, now)) {
          await this.activateGroupRoleGrant(grant, now);
          result.activated += 1;
        }
      } catch (error) {
        result.failed += 1;
        await this.recordGroupRoleSyncFailure(grant.id, error);
      }
    }

    return result;
  }

  private async activateGrant(grant: GrantRecord, now: Date): Promise<void> {
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    await this.keycloakService.addUserClientRoles(grant.userId, [grant.roleName], grant.clientId);
    await this.markSynced(grant.id, now);
  }

  private async expireGrant(grant: GrantRecord, now: Date): Promise<void> {
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    await this.keycloakService.removeUserClientRoles(grant.userId, [grant.roleName], grant.clientId);

    await this.prisma.keycloakPermissionGrant.update({
      where: { id: grant.id },
      data: {
        deletedAt: now,
        updatedById: SYNC_ACTOR_ID,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async activateGroupRoleGrant(grant: GroupRoleGrantRecord, now: Date): Promise<void> {
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    await this.keycloakService.addGroupClientRoles(grant.keycloakGroupId, [grant.roleName], grant.clientId);
    await this.markGroupRoleSynced(grant.id, now);
  }

  private async expireGroupRoleGrant(grant: GroupRoleGrantRecord, now: Date): Promise<void> {
    if (!isDbManagedRole(grant.roleName)) {
      return;
    }

    await this.keycloakService.removeGroupClientRoles(grant.keycloakGroupId, [grant.roleName], grant.clientId);

    await this.prisma.keycloakGroupPermissionGrant.update({
      where: { id: grant.id },
      data: {
        deletedAt: now,
        updatedById: SYNC_ACTOR_ID,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async activateMembership(membership: MembershipRecord, now: Date): Promise<void> {
    const group = getPermissionGroupDefinition(membership.entity as PermissionGroupKey);
    await this.keycloakService.addUserToGroupId(membership.userId, group.keycloakGroupId, group.keycloakGroupPath);
    await this.markMembershipSynced(membership.id, now);
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      membership.userId,
      'permission-group-membership-activated',
    );
  }

  private async expireMembership(membership: MembershipRecord, now: Date): Promise<void> {
    const group = getPermissionGroupDefinition(membership.entity as PermissionGroupKey);
    await this.keycloakService.removeUserFromGroupId(membership.userId, group.keycloakGroupId, group.keycloakGroupPath);

    await this.prisma.studentEntityMembership.update({
      where: { id: membership.id },
      data: {
        deletedAt: now,
        updatedById: SYNC_ACTOR_ID,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
    await this.deactivateLinkedPermissionGrants(membership, now);
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      membership.userId,
      'permission-group-membership-expired',
    );
  }

  private async markSynced(id: string, now: Date): Promise<void> {
    await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async markGroupRoleSynced(id: string, now: Date): Promise<void> {
    await this.prisma.keycloakGroupPermissionGrant.update({
      where: { id },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async markMembershipSynced(id: string, now: Date): Promise<void> {
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async deactivateLinkedPermissionGrants(membership: MembershipRecord, now: Date): Promise<void> {
    for (const grant of membership.permissionGrants) {
      if (!isDbManagedRole(grant.roleName)) {
        continue;
      }

      if (isGrantActive(grant, now)) {
        await this.keycloakService.removeUserClientRoles(grant.userId, [grant.roleName], grant.clientId);
      }

      await this.prisma.keycloakPermissionGrant.update({
        where: { id: grant.id },
        data: {
          deletedAt: now,
          updatedById: SYNC_ACTOR_ID,
          lastSyncedAt: now,
          lastSyncError: null,
        },
      });
    }
  }

  private async recordSyncFailure(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Failed to sync Keycloak permission grant', {
      grantId: id,
      error: message,
    });
    await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        lastSyncError: message,
      },
    });
  }

  private async recordGroupRoleSyncFailure(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Failed to sync Keycloak group permission grant', {
      grantId: id,
      error: message,
    });
    await this.prisma.keycloakGroupPermissionGrant.update({
      where: { id },
      data: {
        lastSyncError: message,
      },
    });
  }

  private async recordMembershipSyncFailure(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Failed to sync permission group membership', {
      membershipId: id,
      error: message,
    });
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        lastSyncError: message,
      },
    });
  }
}
