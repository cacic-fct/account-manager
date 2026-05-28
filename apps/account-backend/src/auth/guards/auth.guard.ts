import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSession } from '../auth.controller';

/**
 * Authentication guard that ensures user is logged in with a valid session
 */
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<Request & { session: AuthSession }>();
    const session: AuthSession = request.session;

    if (!session?.user?.keycloakId) {
      throw new UnauthorizedException('Authentication required');
    }

    return true;
  }
}
