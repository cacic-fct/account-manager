import { Injectable, Logger } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import { getUserOnboardingStatus } from './user-schema';

@Injectable()
export class UserSchemaReconciliationService {
  private readonly logger = new Logger(UserSchemaReconciliationService.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  async reconcile(): Promise<void> {
    const pageSize = 100;
    let hasMore = true;
    let failed = 0;
    for (let first = 0; hasMore; first += pageSize) {
      // Keep the query unfiltered: resetting flags must not change page offsets.
      const page = await this.keycloakService.getOnboardingUserPage(first, pageSize);
      hasMore = page.hasMore;
      for (const user of page.users) {
        if (user.attributes.isOnboarded?.[0] !== 'true' || !getUserOnboardingStatus(user.attributes).needsOnboarding) {
          continue;
        }
        try {
          await this.keycloakService.reconcileUserOnboarding(user.id);
        } catch (error) {
          failed += 1;
          this.logger.error('Failed to reconcile user schema', { userId: user.id, error });
        }
      }
    }
    if (failed > 0) {
      throw new Error(`User schema reconciliation failed for ${failed} user(s)`);
    }
  }
}
