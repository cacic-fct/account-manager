import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSession } from '../auth.controller';
import { AccountPermissionService } from '../services/account-permission.service';

@Injectable()
export class DiscordAdminGuard implements CanActivate {
  private readonly logger = new Logger(DiscordAdminGuard.name);

  constructor(private readonly accountPermissionService: AccountPermissionService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { session: AuthSession }>();
    const userId = request.session?.user?.keycloakId;

    if (!userId) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      const hasDiscordAdminAccess = await this.accountPermissionService.hasDiscordAdminAccess(userId);
      if (hasDiscordAdminAccess) {
        return true;
      }

      throw new ForbiddenException('Discord admin permission missing');
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      this.logger.error('Discord admin permission verification failed', error);
      throw new ForbiddenException('Unable to verify Discord admin permission');
    }
  }
}
