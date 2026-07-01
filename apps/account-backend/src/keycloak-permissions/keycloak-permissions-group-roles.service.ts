import {
  PermissionGroupKey,
  PermissionGroupRoleGrant,
  PermissionGroupRoleGrantUpdateRequest,
} from '@cacic/shared-types';
import {
  ForbiddenException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AccountPermissionService } from '../auth/services/account-permission.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getPermissionGroupDefinition,
  mapGroupRoleGrant,
  normalizePermissionList,
  parsePermissionOrThrow,
} from './keycloak-permissions.helpers';
import {
  DB_MANAGED_ROLE_FILTER,
  GROUP_ROLE_GRANT_SELECT,
} from './keycloak-permissions.records';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';

@Injectable()
export class KeycloakPermissionsGroupRolesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly catalog: KeycloakPermissionsCatalogService,
    private readonly sync: KeycloakPermissionsSyncService,
  ) {}

  async listPermissionGroupRoleGrants(
    groupKey: PermissionGroupKey,
  ): Promise<PermissionGroupRoleGrant[]> {
    const group = getPermissionGroupDefinition(groupKey);
    const [dbGrants, keycloakPermissions] = await Promise.all([
      this.prisma.keycloakGroupPermissionGrant.findMany({
        where: {
          groupKey,
          deletedAt: null,
          roleName: DB_MANAGED_ROLE_FILTER,
        },
        select: GROUP_ROLE_GRANT_SELECT,
        orderBy: [{ clientId: 'asc' }, { roleName: 'asc' }],
      }),
      this.catalog.listKeycloakGroupPermissions(group, {
        allowPartial: true,
      }),
    ]);
    const grants = dbGrants.map((grant) => mapGroupRoleGrant(grant));
    const dbPermissionSet = new Set(grants.map((grant) => grant.permission));

    for (const permission of keycloakPermissions) {
      if (dbPermissionSet.has(permission.permission)) {
        continue;
      }

      grants.push({
        id: `keycloak:${group.key}:${permission.permission}`,
        groupKey: group.key,
        clientId: permission.clientId,
        roleName: permission.roleName,
        permission: permission.permission,
        source: 'keycloak',
        validFrom: null,
        validUntil: null,
        status: 'active',
      });
    }

    return grants.sort((left, right) =>
      `${left.clientId}:${left.roleName}`.localeCompare(
        `${right.clientId}:${right.roleName}`,
      ),
    );
  }

  async updatePermissionGroupRoleGrants(
    groupKey: PermissionGroupKey,
    input: PermissionGroupRoleGrantUpdateRequest,
    actorId?: string,
  ): Promise<PermissionGroupRoleGrant[]> {
    const group = getPermissionGroupDefinition(groupKey);
    const permissions = normalizePermissionList(input.permissions);
    await this.catalog.assertPermissionsKnown(permissions);

    if (!actorId) {
      throw new ForbiddenException('Authentication required');
    }

    const existingDbGrants =
      await this.prisma.keycloakGroupPermissionGrant.findMany({
        where: {
          groupKey,
          deletedAt: null,
          roleName: DB_MANAGED_ROLE_FILTER,
        },
        select: GROUP_ROLE_GRANT_SELECT,
      });
    const existingByPermission = new Map(
      existingDbGrants.map((grant) => [grant.permission, grant]),
    );
    const desiredPermissions = new Set(permissions);
    const groupPermissionState =
      await this.catalog.listKeycloakGroupPermissionsWithAvailability(group, {
        allowPartial: true,
      });
    const keycloakPermissions = groupPermissionState.permissions;
    this.assertDesiredClientsAvailable(
      permissions,
      groupPermissionState.unavailableClientIds,
    );
    const currentPermissions = new Set([
      ...existingByPermission.keys(),
      ...keycloakPermissions.map((permission) => permission.permission),
    ]);
    const permissionsToAdd = permissions.filter(
      (permission) => !currentPermissions.has(permission),
    );
    const dbGrantsToRemove = existingDbGrants.filter(
      (grant) => !desiredPermissions.has(grant.permission),
    );
    const keycloakPermissionsToRemove = keycloakPermissions.filter(
      (permission) =>
        !desiredPermissions.has(permission.permission) &&
        !existingByPermission.has(permission.permission),
    );

    for (const permission of permissionsToAdd) {
      await this.assertActorCanAssignPermission(actorId, permission);
    }

    for (const grant of dbGrantsToRemove) {
      await this.assertActorCanRevokePermission(actorId, grant.permission);
    }

    for (const permission of keycloakPermissionsToRemove) {
      await this.assertActorCanRevokePermission(actorId, permission.permission);
    }

    for (const grant of dbGrantsToRemove) {
      await this.keycloakService.removeGroupClientRoles(
        grant.keycloakGroupId,
        [grant.roleName],
        grant.clientId,
      );
      await this.prisma.keycloakGroupPermissionGrant.update({
        where: { id: grant.id },
        data: {
          deletedAt: new Date(),
          updatedById: actorId,
          lastSyncedAt: new Date(),
          lastSyncError: null,
        },
      });
    }

    for (const permission of keycloakPermissionsToRemove) {
      await this.keycloakService.removeGroupClientRoles(
        group.keycloakGroupId,
        [permission.roleName],
        permission.clientId,
      );
    }

    for (const permission of permissionsToAdd) {
      const parsedPermission = parsePermissionOrThrow(permission);
      const grant = await this.prisma.keycloakGroupPermissionGrant.create({
        data: {
          groupKey,
          keycloakGroupId: group.keycloakGroupId,
          permission,
          clientId: parsedPermission.clientId,
          roleName: parsedPermission.roleName,
          createdById: actorId,
          updatedById: actorId,
        },
        select: GROUP_ROLE_GRANT_SELECT,
      });
      await this.sync.syncGroupRoleGrantAfterWrite(grant, {
        throwOnFailure: false,
      });
    }

    return this.listPermissionGroupRoleGrants(groupKey);
  }

  private async assertActorCanAssignPermission(
    actorId: string,
    permission: string,
  ): Promise<void> {
    if (
      !(await this.accountPermissionService.canAssignPermission(
        actorId,
        permission,
      ))
    ) {
      throw new ForbiddenException(
        'Você não pode conceder uma permissão que não possui.',
      );
    }
  }

  private async assertActorCanRevokePermission(
    actorId: string,
    permission: string,
  ): Promise<void> {
    if (
      !(await this.accountPermissionService.canRevokePermission(
        actorId,
        permission,
      ))
    ) {
      throw new ForbiddenException(
        'Você não pode revogar uma permissão que não possui.',
      );
    }
  }

  private assertDesiredClientsAvailable(
    permissions: readonly string[],
    unavailableClientIds: readonly string[],
  ): void {
    const unavailableClientSet = new Set(unavailableClientIds);
    if (unavailableClientSet.size === 0) {
      return;
    }

    const requestedUnavailableClientIds = [
      ...new Set(
        permissions
          .map((permission) => parsePermissionOrThrow(permission).clientId)
          .filter((clientId) => unavailableClientSet.has(clientId)),
      ),
    ];
    if (requestedUnavailableClientIds.length === 0) {
      return;
    }

    throw new ServiceUnavailableException(
      `Permissões do grupo indisponíveis para: ${requestedUnavailableClientIds.join(', ')}.`,
    );
  }
}
