import {
  ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
  ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
  AccountManagerPermission,
  AccountManagerKeycloakRole,
  KEYCLOAK_PERMISSION_CLIENTS,
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

  async hasAnyActivePermission(
    userId: string,
    permissions: readonly string[],
    now = new Date(),
  ): Promise<boolean> {
    const normalizedPermissions = this.normalizePermissionList(permissions);
    if (normalizedPermissions.length === 0) {
      return false;
    }

    const permissionsWithSuperAdmin = [
      ...new Set([
        ...normalizedPermissions,
        AccountManagerPermission.SuperAdmin,
      ]),
    ];

    return this.hasAnyDirectOrGroupPermission(
      userId,
      permissionsWithSuperAdmin,
      now,
    );
  }

  async hasAllActivePermissions(
    userId: string,
    permissions: readonly string[],
    now = new Date(),
  ): Promise<boolean> {
    const normalizedPermissions = this.normalizePermissionList(permissions);
    if (normalizedPermissions.length === 0) {
      return false;
    }

    if (await this.hasAccountManagerSuperAdminGrant(userId, now)) {
      return true;
    }

    const results = await Promise.all(
      normalizedPermissions.map((permission) =>
        this.hasAnyDirectOrGroupPermission(userId, [permission], now),
      ),
    );

    return results.every(Boolean);
  }

  async hasAccountManagerSuperAdminGrant(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.hasAnyDirectOrGroupPermission(
      userId,
      [AccountManagerPermission.SuperAdmin],
      now,
    );
  }

  async hasAccountManagerSuperAdminAccess(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return (
      (await this.hasAccountManagerSuperAdminGrant(userId, now)) ||
      (await this.hasKeycloakSuperAdminBootstrapFallbackAccess(userId))
    );
  }

  async hasKeycloakSuperAdminBootstrapAccess(userId: string): Promise<boolean> {
    const userRoles = await this.keycloakService.getUserRoles(userId);
    return userRoles.includes(AccountManagerKeycloakRole.SuperAdmin);
  }

  async hasAccountManagerAdminAccess(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.hasAnyActivePermission(
      userId,
      ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
      now,
    );
  }

  async hasDiscordAdminAccess(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return (
      (await this.hasAccountManagerSuperAdminAccess(userId, now)) ||
      (await this.hasAnyActivePermission(
        userId,
        [
          AccountManagerPermission.DiscordManagementRead,
          AccountManagerPermission.DiscordManagementUpdate,
        ],
        now,
      ))
    );
  }

  async canAssignPermission(
    actorId: string,
    permission: string,
    now = new Date(),
  ): Promise<boolean> {
    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission) {
      return false;
    }

    if (
      parsedPermission.clientId === ACCOUNT_MANAGER_PERMISSION_CLIENT_ID &&
      (await this.hasKeycloakSuperAdminBootstrapFallbackAccess(actorId))
    ) {
      return true;
    }

    if (
      !(await this.hasAnyActivePermission(
        actorId,
        [AccountManagerPermission.PermissionGrantAssign],
        now,
      ))
    ) {
      return false;
    }

    if (
      await this.hasClientSuperAdminPermission(
        actorId,
        parsedPermission.clientId,
        now,
      )
    ) {
      return true;
    }

    return this.hasAnyDirectOrGroupPermission(actorId, [permission], now);
  }

  async canRevokePermission(
    actorId: string,
    permission: string,
    now = new Date(),
  ): Promise<boolean> {
    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission) {
      return false;
    }

    if (
      parsedPermission.clientId === ACCOUNT_MANAGER_PERMISSION_CLIENT_ID &&
      (await this.hasKeycloakSuperAdminBootstrapFallbackAccess(actorId))
    ) {
      return true;
    }

    if (
      !(await this.hasAnyActivePermission(
        actorId,
        [AccountManagerPermission.PermissionGrantRevoke],
        now,
      ))
    ) {
      return false;
    }

    if (
      await this.hasClientSuperAdminPermission(
        actorId,
        parsedPermission.clientId,
        now,
      )
    ) {
      return true;
    }

    return this.hasAnyDirectOrGroupPermission(actorId, [permission], now);
  }

  async hasClientSuperAdminPermission(
    userId: string,
    clientId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.hasAnyDirectOrGroupPermission(
      userId,
      [`${clientId}:super-admin`],
      now,
    );
  }

  private async hasAnyDirectOrGroupPermission(
    userId: string,
    permissions: readonly string[],
    now: Date,
  ): Promise<boolean> {
    if (permissions.length === 0) {
      return false;
    }

    if (await this.hasAnyDirectPermissionGrant(userId, permissions, now)) {
      return true;
    }

    return (
      (await this.hasAnyGroupPermissionGrant(userId, permissions, now)) ||
      (await this.hasAnyKeycloakGroupPermissionGrant(userId, permissions, now))
    );
  }

  private async hasKeycloakSuperAdminBootstrapFallbackAccess(
    userId: string,
  ): Promise<boolean> {
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

  private async hasAnyKeycloakGroupPermissionGrant(
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

    if (memberships.length === 0) {
      return false;
    }

    const permissionsByClient = new Map<string, Set<string>>();
    for (const permission of permissions) {
      const parsedPermission = parseKeycloakPermissionId(permission);
      if (!parsedPermission) {
        continue;
      }

      const clientRoles =
        permissionsByClient.get(parsedPermission.clientId) ?? new Set<string>();
      clientRoles.add(parsedPermission.roleName);
      permissionsByClient.set(parsedPermission.clientId, clientRoles);
    }

    if (permissionsByClient.size === 0) {
      return false;
    }

    for (const membership of memberships) {
      if (!isPermissionGroupKey(membership.entity)) {
        continue;
      }

      const group = getPermissionGroupDefinition(membership.entity);
      for (const client of KEYCLOAK_PERMISSION_CLIENTS) {
        const expectedRoles = permissionsByClient.get(client.clientId);
        if (!expectedRoles || expectedRoles.size === 0) {
          continue;
        }

        const groupRoles = await this.keycloakService.getGroupClientRoles(
          group.keycloakGroupId,
          client.clientId,
        );
        if (groupRoles.some((roleName) => expectedRoles.has(roleName))) {
          return true;
        }
      }
    }

    return false;
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

    const groupKeys = [
      ...new Set(memberships.map((membership) => membership.entity)),
    ];
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
      ...new Set(
        permissions
          .map((permission) => permission.trim())
          .filter((permission) => permission.length > 0),
      ),
    ];
  }
}
