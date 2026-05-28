import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSession } from '../auth.controller';
import { KeycloakService } from '../services/keycloak.service';

/**
 * Guard that ensures user is authenticated AND has NOT completed university role verification
 * (i.e., unespRoleVerified attribute is not set to "true")
 */
@Injectable()
export class UniversityValidationGuard implements CanActivate {
  private readonly logger = new Logger(UniversityValidationGuard.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<Request & { session: AuthSession }>();
    const session: AuthSession = request.session;

    // First check if user is authenticated
    if (!session?.user?.keycloakId) {
      throw new UnauthorizedException('Authentication required');
    }

    try {
      // Get user attributes from Keycloak
      const attributes = await this.keycloakService.getUserAttributes(
        session.user.keycloakId,
      );

      // Check if unespRoleVerified is set to "true"
      const unespRoleVerified = attributes['unespRoleVerified'];

      this.logger.debug('Checking university validation status', {
        userId: session.user.keycloakId,
        unespRoleVerified,
        allAttributes: Object.keys(attributes),
      });

      // If the attribute exists and is set to "true", deny access
      if (unespRoleVerified && unespRoleVerified.includes('true')) {
        this.logger.warn(
          `Access denied: University role already verified for user ${session.user.keycloakId}`,
        );
        throw new ForbiddenException(
          'University role verification already completed. Access to validation endpoints is not allowed.',
        );
      }

      // If not verified (attribute doesn't exist or is not "true"), allow access
      this.logger.debug('Access allowed: University role not yet verified', {
        userId: session.user.keycloakId,
      });
      return true;
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }

      // Log the error but don't expose internal details
      this.logger.error('Error checking university validation status', error);
      throw new ForbiddenException(
        'Unable to verify university validation status',
      );
    }
  }
}
