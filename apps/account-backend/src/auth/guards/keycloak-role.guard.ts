import {
  ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
  AccountManagerKeycloakRole,
  buildKeycloakPermissionId,
  parseKeycloakPermissionId,
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

export const RequireKeycloakRoles = (roles: readonly string[], mode: 'any' | 'all' = 'any') =>
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
    const config = this.reflector.getAllAndOverride<KeycloakRoleConfig>(KEYCLOAK_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!config || config.roles.length === 0) {
      throw new ForbiddenException('Required Keycloak roles are not configured');
    }

    const request = context.switchToHttp().getRequest<Request & { session: AuthSession }>();
    const userId = request.session?.user?.keycloakId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    let keycloakError: unknown;

    try {
      const userRoles = await this.keycloakService.getUserRoles(userId);
      if (userRoles.includes(AccountManagerKeycloakRole.SuperAdmin)) {
        return true;
      }

      const hasRequiredRoles = hasRequiredKeycloakRoles(userRoles, config.roles, config.mode);

      if (hasRequiredRoles) {
        return true;
      }
    } catch (error) {
      keycloakError = error;
      this.logger.warn('Keycloak role verification failed; checking database-backed permissions', error);
    }

    try {
      const hasDbSuperAdmin = await this.accountPermissionService.hasAnyActivePermission(userId, [
        AccountManagerKeycloakRole.SuperAdmin,
      ]);

      if (hasDbSuperAdmin) {
        return true;
      }

      const dbBackedPermissions = this.getDbBackedAccountManagerPermissions(config.roles);
      const canFullyMapRolesToDbPermissions = dbBackedPermissions.length === config.roles.length;
      const hasDbPermission =
        config.mode === 'all'
          ? canFullyMapRolesToDbPermissions &&
            (
              await Promise.all(
                dbBackedPermissions.map((permission) =>
                  this.accountPermissionService.hasAnyActivePermission(userId, [permission]),
                ),
              )
            ).every(Boolean)
          : dbBackedPermissions.length > 0 &&
            (await this.accountPermissionService.hasAnyActivePermission(userId, dbBackedPermissions));

      if (hasDbPermission) {
        return true;
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Database-backed permission verification failed', error);
      throw new ForbiddenException('Unable to verify permissions');
    }

    if (keycloakError) {
      throw new ForbiddenException('Unable to verify Keycloak roles');
    }

    throw new ForbiddenException('Required permission missing');
  }

  private getDbBackedAccountManagerPermissions(roles: readonly string[]): string[] {
    const accountManagerRoleNames = new Set<string>(Object.values(AccountManagerKeycloakRole));

    return [
      ...new Set(
        roles.flatMap((role) => {
          const parsedPermission = parseKeycloakPermissionId(role);
          if (parsedPermission) {
            return parsedPermission.clientId === ACCOUNT_MANAGER_PERMISSION_CLIENT_ID &&
              accountManagerRoleNames.has(parsedPermission.roleName)
              ? [buildKeycloakPermissionId(parsedPermission.clientId, parsedPermission.roleName)]
              : [];
          }

          const roleName = role.trim();
          return accountManagerRoleNames.has(roleName)
            ? [buildKeycloakPermissionId(ACCOUNT_MANAGER_PERMISSION_CLIENT_ID, roleName)]
            : [];
        }),
      ),
    ];
  }
}
