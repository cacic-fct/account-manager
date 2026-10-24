import { Logger } from '@nestjs/common';
import { KeycloakService } from './keycloak.service';
import { UserSchemaReconciliationService } from './user-schema-reconciliation.service';
import * as schema from './user-schema';

describe(UserSchemaReconciliationService.name, () => {
  const keycloak = {
    getOnboardingUserPage: jest.fn(),
    reconcileUserOnboarding: jest.fn(),
  };
  let service: UserSchemaReconciliationService;

  beforeEach(() => {
    jest.resetAllMocks();
    jest.replaceProperty(schema, 'REQUIRED_ONBOARDING_SCHEMA_VERSION', 1);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    keycloak.reconcileUserOnboarding.mockResolvedValue({});
    service = new UserSchemaReconciliationService(keycloak as unknown as KeycloakService);
  });
  afterEach(() => jest.restoreAllMocks());

  const user = (id: string, version?: number, onboarded = true) => ({
    id,
    attributes: {
      fullName: ['User Test'],
      phone: ['+5514999999999'],
      'identity-document': ['12345678901'],
      isOnboarded: [String(onboarded)],
      ...(version === undefined ? {} : { userSchemaVersion: [String(version)] }),
    },
  });

  it('proactively reconciles every page without requiring a login', async () => {
    keycloak.getOnboardingUserPage
      .mockResolvedValueOnce({
        users: [user('legacy'), user('current', schema.REQUIRED_ONBOARDING_SCHEMA_VERSION)],
        hasMore: true,
      })
      .mockResolvedValueOnce({ users: [user('legacy-2'), user('incomplete', undefined, false)], hasMore: false });

    await service.reconcile();

    expect(keycloak.getOnboardingUserPage.mock.calls).toEqual([
      [0, 100],
      [100, 100],
    ]);
    expect(keycloak.reconcileUserOnboarding.mock.calls).toEqual([['legacy'], ['legacy-2']]);
  });

  it('continues after an individual write fails and fails the job for a queue retry', async () => {
    keycloak.getOnboardingUserPage.mockResolvedValue({ users: [user('legacy'), user('other')], hasMore: false });
    keycloak.reconcileUserOnboarding.mockRejectedValueOnce(new Error('write failed'));

    await expect(service.reconcile()).rejects.toThrow('1 user(s)');
    await service.reconcile();

    expect(keycloak.reconcileUserOnboarding.mock.calls).toEqual([['legacy'], ['other'], ['legacy'], ['other']]);
  });

  it('propagates a listing failure so BullMQ can retry it', async () => {
    keycloak.getOnboardingUserPage.mockRejectedValueOnce(new Error('offline'));
    await expect(service.reconcile()).rejects.toThrow('offline');
    keycloak.getOnboardingUserPage.mockResolvedValue({ users: [], hasMore: false });
    await service.reconcile();
    expect(keycloak.getOnboardingUserPage).toHaveBeenCalledTimes(2);
  });
});
