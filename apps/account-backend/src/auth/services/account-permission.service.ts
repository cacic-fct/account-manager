import {
  ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
  AccountManagerPermission,
  parseKeycloakPermissionId,
} from '@cacic/shared-types';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class AccountPermissionService {
  constructor(private readonly prisma: PrismaService) {}

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
    return this.hasAnyActivePermission(
      userId,
      [
        AccountManagerPermission.DiscordManagementRead,
        AccountManagerPermission.DiscordManagementUpdate,
      ],
      now,
    );
  }

  async canAssignPermission(
    actorId: string,
    permission: string,
    now = new Date(),
  ): Promise<boolean> {
    if (
      !(await this.hasAnyActivePermission(
        actorId,
        [AccountManagerPermission.PermissionGrantAssign],
        now,
      ))
    ) {
      return false;
    }

    const parsedPermission = parseKeycloakPermissionId(permission);
    if (!parsedPermission) {
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

    return this.hasAnyGroupPermissionGrant(userId, permissions, now);
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
        permission: { in: [...permissions] },
        OR: [{ validFrom: null }, { validFrom: { lte: now } }],
        AND: [{ OR: [{ validUntil: null }, { validUntil: { gt: now } }] }],
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
