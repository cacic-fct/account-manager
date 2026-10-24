import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';
import { getUserOnboardingStatus } from '../user-schema';
import { KeycloakUnespRoleVerificationOperations } from './keycloak-unesp-role-verification.operations';

export interface OnboardingUserPage {
  users: { id: string; attributes: Record<string, string[]> }[];
  hasMore: boolean;
}

export abstract class KeycloakOnboardingOperations extends KeycloakUnespRoleVerificationOperations {
  async getOnboardingUserPage(first: number, max: number): Promise<OnboardingUserPage> {
    const token = await this.getAdminToken();
    const query = new URLSearchParams({ first: String(first), max: String(max), briefRepresentation: 'false' });
    const response = await this.fetchWithTimeout(
      `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users?${query.toString()}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!response.ok) {
      throw new KeycloakConnectionException(`Unable to list users for onboarding reconciliation (${response.status})`);
    }

    const data: unknown = await response.json();
    if (!Array.isArray(data)) {
      throw new KeycloakConnectionException('Authentication service returned an invalid user list');
    }

    const users: OnboardingUserPage['users'] = [];
    for (const entry of data as unknown[]) {
      if (!entry || typeof entry !== 'object' || !('id' in entry) || typeof entry.id !== 'string') {
        throw new KeycloakConnectionException('Authentication service returned an invalid user list');
      }
      // Machine accounts do not complete the human profile form.
      if ('serviceAccountClientId' in entry && entry.serviceAccountClientId) {
        continue;
      }
      const attributes: unknown = 'attributes' in entry ? entry.attributes : {};
      if (
        !attributes ||
        typeof attributes !== 'object' ||
        Array.isArray(attributes) ||
        Object.values(attributes).some(
          (values: unknown) => !Array.isArray(values) || values.some((value: unknown) => typeof value !== 'string'),
        )
      ) {
        throw new KeycloakConnectionException('Authentication service returned invalid account attributes');
      }
      users.push({ id: entry.id, attributes: attributes as Record<string, string[]> });
    }

    // Count the original page, including skipped machine accounts, to preserve pagination.
    return { users, hasMore: data.length === max };
  }

  async reconcileUserOnboarding(userId: string): Promise<Record<string, string[]>> {
    let attributes: Record<string, string[]> = {};
    let changed = false;
    // Share the existing write queue so a concurrent profile save cannot be reset
    // using an earlier snapshot. Notify consumers only after releasing the queue.
    await this.serializeUserUpdate(userId, async () => {
      attributes = await this.getUserAttributes(userId);
      if (attributes.isOnboarded?.[0] !== 'true' || !getUserOnboardingStatus(attributes).needsOnboarding) {
        return;
      }

      const patch = { isOnboarded: ['false'], updatedAt: [new Date().toISOString()] };
      await this.saveUserAttributes(userId, patch, { skipValidation: true });
      attributes = { ...attributes, ...patch };
      changed = true;
    });
    if (changed) {
      // A consumer may already be waiting for this profile read (Discord role sync).
      // Start its follow-up work without making the read wait for that same consumer.
      void this.notifyUserUpdated(userId);
    }
    return attributes;
  }
}
