import {
  Injectable,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { CsrfService } from './csrf.service';

export const SKIP_CSRF_KEY = 'skipCsrf';

/**
 * Decorator to skip CSRF validation for specific endpoints
 * Use this for endpoints that don't change state or have alternative protection
 */
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

/**
 * Extended request interface that includes session with CSRF token
 */
interface CsrfRequest extends Request {
  session: Request['session'] & {
    csrfToken?: string;
  };
}

/**
 * Guard to validate CSRF tokens on state-changing requests
 * Protects against Cross-Site Request Forgery attacks
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  constructor(
    private readonly csrfService: CsrfService,
    private readonly reflector: Reflector,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    // Check if CSRF validation should be skipped for this endpoint
    const skipCsrf = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (skipCsrf) {
      return true;
    }

    const request = context.switchToHttp().getRequest<CsrfRequest>();
    const method = request.method.toUpperCase();

    // Only validate CSRF for state-changing methods
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
      return true;
    }

    // Get CSRF token from header (primary) or body (fallback)
    const tokenFromRequest =
      request.headers['x-csrf-token'] ||
      (request.body as { csrfToken?: string })?.csrfToken;

    // Get CSRF token from session
    const tokenFromSession = request.session.csrfToken;

    // Validate tokens
    if (
      !this.csrfService.validateToken(
        tokenFromRequest as string,
        tokenFromSession as string,
      )
    ) {
      throw new ForbiddenException(
        'Invalid or missing CSRF token. Please refresh the page and try again.',
      );
    }

    return true;
  }
}
