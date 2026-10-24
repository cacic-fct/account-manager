import {
  PermissionGroupDefinition,
  PermissionGroupKey,
  KeycloakPermissionDefinition,
  KeycloakPermissionLiveAccess,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionSyncResult,
  KeycloakPermissionUser,
  PermissionGroupMembership,
  PermissionGroupMembershipCreateRequest,
  PermissionGroupMembershipUpdateRequest,
  PermissionGroupRoleGrant,
  PermissionGroupRoleGrantUpdateRequest,
  PermissionSelfRemovalResult,
  PermissionSelfServiceAccess,
} from '@cacic/shared-types';
import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import { RECURRING_JOB_OPTIONS } from '../background-jobs/background-jobs.queue';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsGrantsService } from './keycloak-permissions-grants.service';
import { KeycloakPermissionsGroupRolesService } from './keycloak-permissions-group-roles.service';
import { KeycloakPermissionsMembershipsService } from './keycloak-permissions-memberships.service';
import {
  KEYCLOAK_PERMISSION_JOBS,
  KEYCLOAK_PERMISSIONS_QUEUE,
  SyncPermissionGrantsJob,
} from './keycloak-permissions.queue';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';

@Injectable()
export class KeycloakPermissionsService implements OnApplicationBootstrap {
  constructor(
    private readonly catalog: KeycloakPermissionsCatalogService,
    private readonly groupRoles: KeycloakPermissionsGroupRolesService,
    private readonly memberships: KeycloakPermissionsMembershipsService,
    private readonly grants: KeycloakPermissionsGrantsService,
    private readonly sync: KeycloakPermissionsSyncService,
    @InjectQueue(KEYCLOAK_PERMISSIONS_QUEUE)
    private readonly permissionQueue: Queue<SyncPermissionGrantsJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    const schedulerId = 'keycloak-permission-grants-sync';
    const repeat = { pattern: '*/15 * * * *' };
    await this.permissionQueue.setGlobalConcurrency(1);
    // Remove the legacy repeat definition before installing its Job Scheduler.
    await this.permissionQueue.removeRepeatable(KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS, repeat, schedulerId);
    // Preserve the legacy BullMQ repeat's default UTC calendar.
    await this.permissionQueue.upsertJobScheduler(
      schedulerId,
      { ...repeat, tz: 'UTC' },
      {
        name: KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS,
        data: { reason: 'scheduled' },
        opts: RECURRING_JOB_OPTIONS,
      },
    );
  }

  listCatalog(): Promise<KeycloakPermissionDefinition[]> {
    return this.catalog.listCatalog();
  }

  getUserLiveAccess(userId: string): Promise<KeycloakPermissionLiveAccess> {
    return this.catalog.getUserLiveAccess(userId);
  }

  listPermissionGroups(): readonly PermissionGroupDefinition[] {
    return this.catalog.listPermissionGroups();
  }

  listPermissionGroupRoleGrants(groupKey: PermissionGroupKey): Promise<PermissionGroupRoleGrant[]> {
    return this.groupRoles.listPermissionGroupRoleGrants(groupKey);
  }

  updatePermissionGroupRoleGrants(
    groupKey: PermissionGroupKey,
    input: PermissionGroupRoleGrantUpdateRequest,
    actorId?: string,
  ): Promise<PermissionGroupRoleGrant[]> {
    return this.groupRoles.updatePermissionGroupRoleGrants(groupKey, input, actorId);
  }

  searchUsers(query: string): Promise<KeycloakPermissionUser[]> {
    return this.grants.searchUsers(query);
  }

  listPermissionGroupMemberships(groupKey?: PermissionGroupKey): Promise<PermissionGroupMembership[]> {
    return this.memberships.listPermissionGroupMemberships(groupKey);
  }

  listUserMemberships(userId: string): Promise<PermissionGroupMembership[]> {
    return this.memberships.listUserMemberships(userId);
  }

  createPermissionGroupMembership(
    input: PermissionGroupMembershipCreateRequest,
    actorId?: string,
  ): Promise<PermissionGroupMembership> {
    return this.memberships.createPermissionGroupMembership(input, actorId);
  }

  updatePermissionGroupMembership(
    id: string,
    input: PermissionGroupMembershipUpdateRequest,
    actorId?: string,
  ): Promise<PermissionGroupMembership> {
    return this.memberships.updatePermissionGroupMembership(id, input, actorId);
  }

  deletePermissionGroupMembership(id: string, actorId?: string): Promise<void> {
    return this.memberships.deletePermissionGroupMembership(id, actorId);
  }

  listUserGrants(userId: string): Promise<KeycloakPermissionGrant[]> {
    return this.grants.listUserGrants(userId);
  }

  createGrant(input: KeycloakPermissionGrantCreateRequest, actorId?: string): Promise<KeycloakPermissionGrant> {
    return this.grants.createGrant(input, actorId);
  }

  updateGrant(
    id: string,
    input: KeycloakPermissionGrantUpdateRequest,
    actorId?: string,
  ): Promise<KeycloakPermissionGrant> {
    return this.grants.updateGrant(id, input, actorId);
  }

  deleteGrant(id: string, actorId?: string): Promise<void> {
    return this.grants.deleteGrant(id, actorId);
  }

  async getSelfServiceAccess(userId: string): Promise<PermissionSelfServiceAccess> {
    const [memberships, grants] = await Promise.all([
      this.memberships.listUserMemberships(userId),
      this.grants.listUserGrants(userId),
    ]);

    return { memberships, grants };
  }

  selfRemoveMembership(userId: string, membershipId: string): Promise<PermissionSelfRemovalResult> {
    return this.memberships.selfRemoveMembership(userId, membershipId);
  }

  selfRemoveGrant(userId: string, grantId: string): Promise<PermissionSelfRemovalResult> {
    return this.grants.selfRemoveGrant(userId, grantId);
  }

  async enqueueSync(reason: 'manual' | 'scheduled' = 'manual'): Promise<void> {
    await this.permissionQueue.add(
      KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS,
      { reason },
      {
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  synchronizePermissionGrants(): Promise<KeycloakPermissionSyncResult> {
    return this.sync.synchronizePermissionGrants();
  }

  synchronizeStudentEntityMemberships(): Promise<KeycloakPermissionSyncResult> {
    return this.sync.synchronizeStudentEntityMemberships();
  }
}
