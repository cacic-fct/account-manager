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

export const CURRENT_USER_TARGET_KEY = 'currentUserTarget';

interface CurrentUserTargetConfig {
  source: 'param' | 'body' | 'query';
  field: string;
}

type RequestWithSession = Omit<Request, 'body' | 'params' | 'query'> & {
  session: AuthSession;
  params: Record<string, string | undefined>;
  query: Record<string, string | string[] | undefined>;
  body?: Record<string, unknown>;
};

export const CurrentUserTarget = (
  source: CurrentUserTargetConfig['source'],
  field = 'userId',
) =>
  SetMetadata(CURRENT_USER_TARGET_KEY, {
    source,
    field,
  } satisfies CurrentUserTargetConfig);

@Injectable()
export class CurrentUserGuard implements CanActivate {
  private readonly logger = new Logger(CurrentUserGuard.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithSession>();
    const currentUserId = request.session?.user?.keycloakId;

    if (!currentUserId) {
      throw new UnauthorizedException('Authentication required');
    }

    const target = this.reflector.getAllAndOverride<CurrentUserTargetConfig>(
      CURRENT_USER_TARGET_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (target) {
      const targetUserId = this.getTargetUserId(request, target);
      if (!targetUserId || targetUserId !== currentUserId) {
        throw new ForbiddenException(
          'Acesso negado: usuário não pode alterar dados de outro usuário',
        );
      }
    }

    await this.assertKeycloakSessionUserIsValid(currentUserId);
    return true;
  }

  private getTargetUserId(
    request: RequestWithSession,
    target: CurrentUserTargetConfig,
  ): string | undefined {
    if (target.source === 'param') {
      return request.params[target.field];
    }

    if (target.source === 'query') {
      const value = request.query[target.field];
      return Array.isArray(value) ? value[0] : value;
    }

    const value = request.body?.[target.field];
    return typeof value === 'string' ? value : undefined;
  }

  private async assertKeycloakSessionUserIsValid(
    userId: string,
  ): Promise<void> {
    try {
      const user = await this.keycloakService.getUserBasicInfo(userId);

      if (!user) {
        throw new UnauthorizedException('Session user no longer exists');
      }

      if (user.enabled === false) {
        throw new ForbiddenException('Session user is disabled');
      }
    } catch (error) {
      if (
        error instanceof UnauthorizedException ||
        error instanceof ForbiddenException
      ) {
        throw error;
      }

      this.logger.error('Failed to validate current user in Keycloak', error);
      throw new ForbiddenException('Unable to validate current user');
    }
  }
}
