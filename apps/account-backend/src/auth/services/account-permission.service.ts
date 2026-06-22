import {
  AccountManagerKeycloakRole,
  AssignableKeycloakPermission,
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
    if (permissions.length === 0) {
      return false;
    }

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

  async hasAccountManagerSuperAdminGrant(userId: string): Promise<boolean> {
    return this.hasAnyActivePermission(userId, [
      AccountManagerKeycloakRole.SuperAdmin,
    ]);
  }

  async hasDiscordAdminAccess(userId: string): Promise<boolean> {
    return this.hasAnyActivePermission(userId, [
      AccountManagerKeycloakRole.SuperAdmin,
      AssignableKeycloakPermission.DiscordAdmin,
    ]);
  }
}
