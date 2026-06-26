import { AccountManagerKeycloakRole } from '@cacic/shared-types';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
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
    if (permissions.length === 0) {
      return false;
    }

    const grantPermissions = this.withSuperAdminPermission(permissions);
    if (await this.hasAnyActivePermissionGrant(userId, grantPermissions, now)) {
      return true;
    }

    return this.hasAccountManagerSuperAdminClientRole(userId);
  }

  async hasAccountManagerSuperAdminGrant(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.hasAnyActivePermissionGrant(
      userId,
      [AccountManagerKeycloakRole.SuperAdmin],
      now,
    );
  }

  async hasDiscordAdminAccess(
    userId: string,
    now = new Date(),
  ): Promise<boolean> {
    return this.hasAnyActivePermission(
      userId,
      [AccountManagerKeycloakRole.SuperAdmin],
      now,
    );
  }

  private async hasAnyActivePermissionGrant(
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

  private async hasAccountManagerSuperAdminClientRole(
    userId: string,
  ): Promise<boolean> {
    const userRoles = await this.keycloakService.getUserRoles(userId);
    return userRoles.includes(AccountManagerKeycloakRole.SuperAdmin);
  }

  private withSuperAdminPermission(
    permissions: readonly string[],
  ): readonly string[] {
    return [
      ...new Set([...permissions, AccountManagerKeycloakRole.SuperAdmin]),
    ];
  }
}
