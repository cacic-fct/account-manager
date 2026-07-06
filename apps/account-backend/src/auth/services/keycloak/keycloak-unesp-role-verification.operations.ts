import { KeycloakApplicationOperations } from './keycloak-application.operations';

export abstract class KeycloakUnespRoleVerificationOperations extends KeycloakApplicationOperations {
  /**
   * Set the Unesp role verification status.
   */
  async setUnespRoleVerified(userId: string, verified: boolean): Promise<void> {
    await this.updateUserAttributes(
      userId,
      {
        unespRoleVerified: [verified.toString()],
      },
      { skipValidation: true },
    );
  }

  /**
   * Get the Unesp role verification status.
   */
  async getUnespRoleVerified(userId: string): Promise<boolean> {
    const attributes = await this.getUserAttributes(userId);
    const verified = attributes.unespRoleVerified?.[0];
    return verified === 'true';
  }

  /**
   * Invalidate Unesp role verification.
   */
  async invalidateUnespRoleVerification(userId: string): Promise<void> {
    await this.setUnespRoleVerified(userId, false);
  }

  /**
   * Verify a user's Unesp role.
   */
  async verifyUserUnespRole(
    userId: string,
    verifiedBy: string,
    verificationMethod: 'document' | 'manual' | 'admin',
  ): Promise<void> {
    this.logger.debug('Verifying Unesp role for user', {
      userId,
      verifiedBy,
      verificationMethod,
      timestamp: new Date().toISOString(),
    });

    await this.setUnespRoleVerified(userId, true);

    await this.updateUserAttributes(
      userId,
      {
        unespRoleVerificationMethod: [verificationMethod],
        unespRoleVerifiedBy: [verifiedBy],
        unespRoleVerificationDate: [new Date().toISOString()],
      },
      { skipValidation: true },
    );
  }
}
