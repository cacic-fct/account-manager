import {
  ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
  AccountManagerPermission,
  AccountManagerKeycloakRole,
  KEYCLOAK_PERMISSION_CLIENTS,
  isKeycloakBackedPermission,
  isKeycloakBackedRoleName,
  isPermissionGroupKey,
  parseKeycloakPermissionId,
} from '@cacic/shared-types';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { getPermissionGroupDefinition } from '../../keycloak-permissions/keycloak-permissions.helpers';
import { KeycloakService } from './keycloak.service';

@Injectable()
export class AccountPermissionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
  ) {}

  async hasAnyActivePermission(userId: string, permissions: readonly string[], now = new Date()): Promise<boolean> {
    const normalizedPermissions = this.normalizePermissionList(permissions);
    if (normalizedPermissions.length === 0) {
      return false;
    }

    if (await this.hasAccountManagerSuperAdminAccess(userId)) {
      return true;
    }

    if (await this.hasAnyKeycloakBackedPermission(userId, normalizedPermissions)) {
      return true;
    }

    return this.hasAnyDirectOrGroupPermission(userId, this.getDbManagedPermissions(normalizedPermissions), now);
  }

  async hasAllActivePermissions(userId: string, permissions: readonly string[], now = new Date()): Promise<boolean> {
    const normalizedPermissions = this.normalizePermissionList(permissions);
    if (normalizedPermissions.length === 0) {
      return false;
    }

    if (await this.hasAccountManagerSuperAdminAccess(userId)) {
      return true;
    }

    const keycloakBackedPermissions = normalizedPermissions.filter(isKeycloakBackedPermission);
    const dbManagedPermissions = this.getDbManagedPermissions(normalizedPermissions);
    const [keycloakResults, dbResults] = await Promise.all([
      Promise.all(keycloakBackedPermissions.map((permission) => this.hasKeycloakBackedPermission(userId, permission))),
      Promise.all(
        dbManagedPermissions.map((permission) => this.hasAnyDirectOrGroupPermission(userId, [permission], now)),
      ),
    ]);

    return [...keycloakResults, ...dbResults].every(Boolean);
  }

  async hasAccountManagerSuperAdminGrant(userId: string): Promise<boolean> {
    return this.hasKeycloakSuperAdminBootstrapFallbackAccess(userId);
  }

  async hasAccountManagerSuperAdminAccess(userId: string): Promise<boolean> {
    return this.hasKeycloakSuperAdminBootstrapFallbackAccess(userId);
  }

  async hasKeycloakSuperAdminBootstrapAccess(userId: string): Promise<boolean> {
    const userRoles = await this.keycloakService.getUserRoles(userId);
    return userRoles.includes(AccountManagerKeycloakRole.SuperAdmin);
  }

  async hasAccountManagerAdminAccess(userId: string, now = new Date()): Promise<boolean> {
    return this.hasAnyActivePermission(userId, ACCOUNT_MANAGER_ADMIN_PERMISSIONS, now);
  }

  async hasDiscordAdminAccess(userId: string, now = new Date()): Promise<boolean> {
    return (
      (await this.hasAccountManagerSuperAdminAccess(userId)) ||
      (await this.hasAnyActivePermission(
        userId,
        [AccountManagerPermission.DiscordManagementRead, AccountManagerPermission.DiscordManagementUpdate],
        now,
      ))
    );
  }

  async canAssignPermission(actorId: string, permission: string, now = new Date()): Promise<boolean> {
    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission) {
      return false;
    }

    if (!(await this.hasAnyDirectOrGroupPermission(actorId, [AccountManagerPermission.PermissionGrantAssign], now))) {
      return false;
    }

    if (await this.hasClientSuperAdminPermission(actorId, parsedPermission.clientId)) {
      return true;
    }

    if (isKeycloakBackedRoleName(parsedPermission.roleName)) {
      return false;
    }

    return this.hasAnyDirectOrGroupPermission(actorId, [permission], now);
  }

  async canRevokePermission(actorId: string, permission: string, now = new Date()): Promise<boolean> {
    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission) {
      return false;
    }

    if (!(await this.hasAnyDirectOrGroupPermission(actorId, [AccountManagerPermission.PermissionGrantRevoke], now))) {
      return false;
    }

    if (await this.hasClientSuperAdminPermission(actorId, parsedPermission.clientId)) {
      return true;
    }

    if (isKeycloakBackedRoleName(parsedPermission.roleName)) {
      return false;
    }

    return this.hasAnyDirectOrGroupPermission(actorId, [permission], now);
  }

  async hasClientSuperAdminPermission(userId: string, clientId: string): Promise<boolean> {
    try {
      const userRoles = await this.keycloakService.getUserClientRoles(userId, clientId);
      return userRoles.includes(AccountManagerKeycloakRole.SuperAdmin);
    } catch {
      return false;
    }
  }

  private async hasAnyDirectOrGroupPermission(
    userId: string,
    permissions: readonly string[],
    now: Date,
  ): Promise<boolean> {
    if (permissions.length === 0) {
      return false;
    }

    const dbManagedPermissions = this.getDbManagedPermissions(permissions);
    if (dbManagedPermissions.length === 0) {
      return false;
    }

    if (await this.hasAnyDirectPermissionGrant(userId, dbManagedPermissions, now)) {
      return true;
    }

    if (await this.hasAnyGroupPermissionGrant(userId, dbManagedPermissions, now)) {
      return true;
    }

    try {
      return await this.hasAnyEffectiveKeycloakPermission(userId, dbManagedPermissions, now);
    } catch {
      return false;
    }
  }

  private async hasAnyEffectiveKeycloakPermission(
    userId: string,
    permissions: readonly string[],
    now: Date,
  ): Promise<boolean> {
    const rolesByClient = new Map<string, Set<string>>();
    for (const permission of permissions) {
      const parsed = parseKeycloakPermissionId(permission);
      if (!parsed || !KEYCLOAK_PERMISSION_CLIENTS.some((client) => client.clientId === parsed.clientId)) {
        continue;
      }
      const roles = rolesByClient.get(parsed.clientId) ?? new Set<string>();
      roles.add(parsed.roleName);
      rolesByClient.set(parsed.clientId, roles);
    }

    const results = await Promise.all(
      [...rolesByClient.keys()].map(async (clientId) => {
        try {
          // Effective roles include direct, group, parent-group, and composite assignments.
          const roles = await this.keycloakService.getUserClientRoles(userId, clientId);
          return { clientId, roles };
        } catch {
          return { clientId, roles: [] };
        }
      }),
    );
    const liveRolesByClient = new Map(results.map(({ clientId, roles }) => [clientId, new Set(roles)]));
    const livePermissions = results.flatMap(({ clientId, roles }) =>
      roles.filter((role) => rolesByClient.get(clientId)?.has(role)).map((role) => `${clientId}:${role}`),
    );
    if (livePermissions.length === 0) {
      return false;
    }
    const excludedPermissions = await this.getInactiveManagedPermissions(userId, liveRolesByClient, now);
    return livePermissions.some((permission) => !excludedPermissions.has(permission));
  }

  private async getInactiveManagedPermissions(
    userId: string,
    rolesByClient: ReadonlyMap<string, ReadonlySet<string>>,
    now: Date,
  ): Promise<Set<string>> {
    // A stale Keycloak mapping must not bypass a local validity window before reconciliation runs.
    const [inactiveGrants, memberships] = await Promise.all([
      this.prisma.keycloakPermissionGrant.findMany({
        where: {
          userId,
          clientId: { in: [...rolesByClient.keys()] },
          OR: [
            { deletedAt: { not: null } },
            { validFrom: { gt: now } },
            { validUntil: { lte: now } },
            {
              studentEntityMembership: {
                is: {
                  OR: [{ deletedAt: { not: null } }, { mandateStart: { gt: now } }, { mandateEnd: { lte: now } }],
                },
              },
            },
          ],
        },
        select: { permission: true },
      }),
      this.prisma.studentEntityMembership.findMany({
        where: { userId },
        select: { entity: true, deletedAt: true, mandateStart: true, mandateEnd: true },
      }),
    ]);
    const groupKeys = memberships.map((membership) => membership.entity).filter(isPermissionGroupKey);
    const inactiveGroupGrants =
      groupKeys.length > 0
        ? await this.prisma.keycloakGroupPermissionGrant.findMany({
            where: {
              groupKey: { in: groupKeys },
              clientId: { in: [...rolesByClient.keys()] },
              OR: [{ deletedAt: { not: null } }, { validFrom: { gt: now } }, { validUntil: { lte: now } }],
            },
            select: { permission: true },
          })
        : [];
    const excluded = new Set<string>();
    for (const grant of [...inactiveGrants, ...inactiveGroupGrants]) {
      const parsed = parseKeycloakPermissionId(grant.permission);
      const liveRoles = parsed ? rolesByClient.get(parsed.clientId) : undefined;
      if (parsed && liveRoles?.has(parsed.roleName)) {
        // A stale composite may provide any expanded role in this client. Fail closed until it is removed.
        liveRoles.forEach((role) => excluded.add(`${parsed.clientId}:${role}`));
      }
    }
    const activeGroupKeys = new Set(
      memberships
        .filter(
          (membership) =>
            !membership.deletedAt &&
            membership.mandateStart <= now &&
            (!membership.mandateEnd || membership.mandateEnd > now),
        )
        .map((membership) => membership.entity),
    );
    const inactiveGroupIds = new Set<string>();
    for (const membership of memberships) {
      if (!isPermissionGroupKey(membership.entity) || activeGroupKeys.has(membership.entity)) {
        continue;
      }
      const inactive =
        membership.deletedAt ||
        membership.mandateStart > now ||
        (membership.mandateEnd && membership.mandateEnd <= now);
      if (inactive) {
        const group = getPermissionGroupDefinition(membership.entity);
        group.keycloakGroupIdPath.split('/').forEach((groupId) => inactiveGroupIds.add(groupId));
      }
    }
    await Promise.all(
      [...inactiveGroupIds].flatMap((groupId) =>
        [...rolesByClient.keys()].map(async (clientId) => {
          const roles = await this.keycloakService.getGroupClientRoles(groupId, clientId, { effective: true });
          roles.forEach((role) => excluded.add(`${clientId}:${role}`));
        }),
      ),
    );
    return excluded;
  }

  private async hasKeycloakSuperAdminBootstrapFallbackAccess(userId: string): Promise<boolean> {
    try {
      return await this.hasKeycloakSuperAdminBootstrapAccess(userId);
    } catch {
      return false;
    }
  }

  private async hasAnyDirectPermissionGrant(
    userId: string,
    permissions: readonly string[],
    now: Date,
  ): Promise<boolean> {
    const grant = await this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        userId,
        deletedAt: null,
        OR: [
          { studentEntityMembershipId: null },
          {
            studentEntityMembership: {
              is: {
                deletedAt: null,
                mandateStart: { lte: now },
                OR: [{ mandateEnd: null }, { mandateEnd: { gt: now } }],
              },
            },
          },
        ],
        permission: { in: [...permissions] },
        AND: [
          { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
          { OR: [{ validUntil: null }, { validUntil: { gt: now } }] },
        ],
      },
      select: { id: true },
    });

    return !!grant;
  }

  private async hasAnyGroupPermissionGrant(
    userId: string,
    permissions: readonly string[],
    now: Date,
  ): Promise<boolean> {
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        userId,
        deletedAt: null,
        mandateStart: { lte: now },
        OR: [{ mandateEnd: null }, { mandateEnd: { gt: now } }],
      },
      select: { entity: true },
    });

    const groupKeys = [...new Set(memberships.map((membership) => membership.entity).filter(isPermissionGroupKey))];
    if (groupKeys.length === 0) {
      return false;
    }

    const grant = await this.prisma.keycloakGroupPermissionGrant.findFirst({
      where: {
        groupKey: { in: groupKeys },
        deletedAt: null,
        permission: { in: [...permissions] },
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: now } }] }],
      },
      select: { id: true },
    });

    return !!grant;
  }

  private normalizePermissionList(permissions: readonly string[]): string[] {
    return [
      ...new Set(permissions.map((permission) => permission.trim()).filter((permission) => permission.length > 0)),
    ];
  }

  private getDbManagedPermissions(permissions: readonly string[]): string[] {
    return permissions.filter((permission) => !isKeycloakBackedPermission(permission));
  }

  private async hasAnyKeycloakBackedPermission(userId: string, permissions: readonly string[]): Promise<boolean> {
    const keycloakBackedPermissions = permissions.filter(isKeycloakBackedPermission);
    if (keycloakBackedPermissions.length === 0) {
      return false;
    }

    const results = await Promise.all(
      keycloakBackedPermissions.map((permission) => this.hasKeycloakBackedPermission(userId, permission)),
    );
    return results.some(Boolean);
  }

  private async hasKeycloakBackedPermission(userId: string, permission: string): Promise<boolean> {
    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission || !isKeycloakBackedRoleName(parsedPermission.roleName)) {
      return false;
    }

    try {
      const userRoles = await this.keycloakService.getUserClientRoles(userId, parsedPermission.clientId);
      return userRoles.includes(parsedPermission.roleName);
    } catch {
      return false;
    }
  }
}
