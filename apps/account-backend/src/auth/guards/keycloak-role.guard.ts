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
import { KeycloakService } from '../services/keycloak.service';

export const KEYCLOAK_ROLES_KEY = 'keycloakRoles';

export interface KeycloakRoleConfig {
  roles: string[];
  mode?: 'any' | 'all';
}

export const RequireKeycloakRoles = (
  roles: string[],
  mode: 'any' | 'all' = 'any',
) =>
  SetMetadata(KEYCLOAK_ROLES_KEY, { roles, mode } satisfies KeycloakRoleConfig);

export const hasRequiredKeycloakRoles = (
  userRoles: string[],
  requiredRoles: string[],
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
      const hasRequiredRoles = hasRequiredKeycloakRoles(
        userRoles,
        config.roles,
        config.mode,
      );

      if (!hasRequiredRoles) {
        throw new ForbiddenException('Required Keycloak role missing');
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
