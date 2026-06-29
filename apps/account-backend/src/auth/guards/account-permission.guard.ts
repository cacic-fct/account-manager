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
import { AccountManagerKeycloakRole } from '@cacic/shared-types';
import { AuthSession } from '../auth.controller';
import { AccountPermissionService } from '../services/account-permission.service';
import { KeycloakService } from '../services/keycloak.service';

export const ACCOUNT_PERMISSIONS_KEY = 'accountPermissions';

export interface AccountPermissionConfig {
  permissions: readonly string[];
  mode?: 'any' | 'all';
}

export const RequireAccountPermissions = (
  permissions: readonly string[],
  mode: 'any' | 'all' = 'any',
) =>
  SetMetadata(ACCOUNT_PERMISSIONS_KEY, {
    permissions,
    mode,
  } satisfies AccountPermissionConfig);

@Injectable()
export class AccountPermissionGuard implements CanActivate {
  private readonly logger = new Logger(AccountPermissionGuard.name);

  constructor(
    private readonly accountPermissionService: AccountPermissionService,
    private readonly keycloakService: KeycloakService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<AccountPermissionConfig>(
      ACCOUNT_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!config || config.permissions.length === 0) {
      throw new ForbiddenException(
        'Required Account Manager permissions are not configured',
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
      const hasPermission =
        config.mode === 'all'
          ? await this.accountPermissionService.hasAllActivePermissions(
              userId,
              config.permissions,
            )
          : await this.accountPermissionService.hasAnyActivePermission(
              userId,
              config.permissions,
            );

      if (
        !hasPermission &&
        !(await this.hasKeycloakSuperAdminBootstrapAccess(userId))
      ) {
        throw new ForbiddenException(
          'Required Account Manager permission missing',
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Account permission verification failed', error);
      throw new ForbiddenException(
        'Unable to verify Account Manager permissions',
      );
    }
  }

  private async hasKeycloakSuperAdminBootstrapAccess(
    userId: string,
  ): Promise<boolean> {
    const userRoles = await this.keycloakService.getUserRoles(userId);
    return userRoles.includes(AccountManagerKeycloakRole.SuperAdmin);
  }
}
