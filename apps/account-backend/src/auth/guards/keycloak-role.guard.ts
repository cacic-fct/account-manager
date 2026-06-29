import {
  AccountManagerKeycloakRole,
  buildKeycloakPermissionId,
} from '@cacic/shared-types';
import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  SetMetadata,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { AuthSession } from '../auth.controller';
import { AccountPermissionService } from '../services/account-permission.service';
import { KeycloakService } from '../services/keycloak.service';

export const KEYCLOAK_ROLES_KEY = 'keycloakRoles';

export interface KeycloakRoleConfig {
  roles: readonly string[];
  mode?: 'any' | 'all';
}

export const RequireKeycloakRoles = (
  roles: readonly string[],
  mode: 'any' | 'all' = 'any',
) =>
  SetMetadata(KEYCLOAK_ROLES_KEY, { roles, mode } satisfies KeycloakRoleConfig);

export const hasRequiredKeycloakRoles = (
  userRoles: readonly string[],
  requiredRoles: readonly string[],
  mode: 'any' | 'all' = 'any',
): boolean =>
  mode === 'all'
    ? requiredRoles.every((role) => userRoles.includes(role))
    : requiredRoles.some((role) => userRoles.includes(role));

@Injectable()
export class KeycloakRoleGuard implements CanActivate {
  private readonly logger = new Logger(KeycloakRoleGuard.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<KeycloakRoleConfig>(
      KEYCLOAK_ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!config || config.roles.length === 0) {
      throw new ForbiddenException(
        'Required Keycloak roles are not configured',
      );
    }

    const request = context
      .switchToHttp()
      .getRequest<Request & { session: AuthSession }>();
    const userId = request.session?.user?.keycloakId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const userRoles = await this.keycloakService.getUserRoles(userId);
      if (userRoles.includes(AccountManagerKeycloakRole.SuperAdmin)) {
        return true;
      }

      const hasRequiredRoles = hasRequiredKeycloakRoles(
        userRoles,
        config.roles,
        config.mode,
      );

      if (hasRequiredRoles) {
        return true;
      }

      const hasDbSuperAdmin =
        await this.accountPermissionService.hasAnyActivePermission(userId, [
          AccountManagerKeycloakRole.SuperAdmin,
        ]);

      if (hasDbSuperAdmin) {
        return true;
      }

      const dbBackedPermissions = [
        ...new Set(
          config.roles.map((role) =>
            role.includes(':')
              ? role
              : buildKeycloakPermissionId('cacic-account-manager', role),
          ),
        ),
      ];
      const hasDbPermission =
        dbBackedPermissions.length > 0 && config.mode === 'all'
          ? (
              await Promise.all(
                dbBackedPermissions.map((permission) =>
                  this.accountPermissionService.hasAnyActivePermission(userId, [
                    permission,
                  ]),
                ),
              )
            ).every(Boolean)
          : dbBackedPermissions.length > 0 &&
            (await this.accountPermissionService.hasAnyActivePermission(
              userId,
              dbBackedPermissions,
            ));

      if (!hasDbPermission) {
        throw new ForbiddenException('Required permission missing');
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Keycloak role verification failed', error);
      throw new ForbiddenException('Unable to verify Keycloak roles');
    }
  }
}
