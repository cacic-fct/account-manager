import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  Logger,
  Optional,
} from '@nestjs/common';
import { Request } from 'express';
import { AuthSession } from '../auth.controller';
import { KeycloakService } from '../services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { UnespRole } from '@cacic/shared-types';

/**
 * Guard that ensures user is authenticated AND has NOT completed university role verification
 * (i.e., unespRoleVerified attribute is not set to "true")
 */
@Injectable()
export class UniversityValidationGuard implements CanActivate {
  private readonly logger = new Logger(UniversityValidationGuard.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly prisma: PrismaService,
    @Optional()
    private readonly featureFlags?: FeatureFlagService,
  ) {}

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
      if (
        await this.isUndergraduateVerificationDisabled(session.user.keycloakId)
      ) {
        throw new ForbiddenException(
          'Undergraduate Unesp role verification is currently disabled.',
        );
      }

      const approvedDocument =
        await this.prisma.studentVerificationDocument.findFirst({
          where: {
            userId: session.user.keycloakId,
            status: 'approved',
          },
          orderBy: {
            verificationDate: 'desc',
          },
        });

      this.logger.debug('Checking university validation status', {
        userId: session.user.keycloakId,
        databaseStatus: approvedDocument?.status ?? 'not_approved',
      });

      if (approvedDocument) {
        this.logger.warn(
          `Access denied: University role already verified for user ${session.user.keycloakId}`,
        );
        throw new ForbiddenException(
          'University role verification already completed. Access to validation endpoints is not allowed.',
        );
      }

      await this.logKeycloakDrift(session.user.keycloakId);

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

  private async logKeycloakDrift(userId: string): Promise<void> {
    try {
      const attributes = await this.keycloakService.getUserAttributes(userId);
      const unespRoleVerified = attributes['unespRoleVerified'];

      if (unespRoleVerified?.includes('true')) {
        this.logger.warn(
          `Student verification drift detected for user ${userId}: database=not_approved, keycloak=approved`,
        );
      }
    } catch (error) {
      this.logger.warn(
        `Could not compare Keycloak verification status for user ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async isUndergraduateVerificationDisabled(
    userId: string,
  ): Promise<boolean> {
    if (
      !(await this.featureFlags?.isUndergraduateUnespRoleVerificationDisabled())
    ) {
      return false;
    }

    const attributes = await this.keycloakService.getUserAttributes(userId);
    return attributes.unespRole?.includes(UnespRole.ALUNO_GRADUACAO) ?? false;
  }
}
