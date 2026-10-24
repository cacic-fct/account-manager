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
import { CurrentUserGuard } from './current-user.guard';

export const ACCOUNT_PERMISSIONS_KEY = 'accountPermissions';

export interface AccountPermissionConfig {
  permissions: readonly string[];
  mode?: 'any' | 'all';
}

export const RequireAccountPermissions = (permissions: readonly string[], mode: 'any' | 'all' = 'any') =>
  SetMetadata(ACCOUNT_PERMISSIONS_KEY, {
    permissions,
    mode,
  } satisfies AccountPermissionConfig);

@Injectable()
export class AccountPermissionGuard implements CanActivate {
  private readonly logger = new Logger(AccountPermissionGuard.name);

  constructor(
    private readonly accountPermissionService: AccountPermissionService,
    private readonly reflector: Reflector,
    private readonly currentUserGuard: CurrentUserGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const config = this.reflector.getAllAndOverride<AccountPermissionConfig>(ACCOUNT_PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!config || config.permissions.length === 0) {
      throw new ForbiddenException(
        'O acesso a esta ação ainda não foi configurado. Peça ao administrador do sistema para revisar as permissões.',
      );
    }

    await this.currentUserGuard.canActivate(context);

    const request = context.switchToHttp().getRequest<Request & { session: AuthSession }>();
    const userId = request.session?.user?.keycloakId;

    if (!userId) {
      throw new UnauthorizedException('Entre na sua conta para continuar.');
    }

    try {
      const hasPermission =
        config.mode === 'all'
          ? await this.accountPermissionService.hasAllActivePermissions(userId, config.permissions)
          : await this.accountPermissionService.hasAnyActivePermission(userId, config.permissions);

      if (!hasPermission && !(await this.accountPermissionService.hasAccountManagerSuperAdminAccess(userId))) {
        throw new ForbiddenException(
          'Sua conta não tem a permissão necessária para esta ação. Peça a um administrador para revisar seu acesso.',
        );
      }

      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Account permission verification failed', error);
      throw new ForbiddenException(
        'Não foi possível verificar suas permissões agora. Tente novamente em alguns instantes.',
      );
    }
  }
}
