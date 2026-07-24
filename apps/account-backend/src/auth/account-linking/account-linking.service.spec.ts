import { AccountLinkingService } from './account-linking.service';

describe('AccountLinkingService', () => {
  const primaryUserId = 'primary-user';
  const secondaryUserId = 'secondary-user';

  function createService(primaryAttributes: Record<string, string[]>, secondaryAttributes: Record<string, string[]>) {
    const keycloakService = {
      getUserAttributes: jest.fn((userId: string) =>
        Promise.resolve(userId === primaryUserId ? primaryAttributes : secondaryAttributes),
      ),
      getUserBasicInfo: jest.fn((userId: string) =>
        Promise.resolve({ email: userId === primaryUserId ? 'primary@example.org' : 'secondary@example.org' }),
      ),
      updateUserAttributes: jest.fn().mockResolvedValue(undefined),
      addUserToGroupPath: jest.fn().mockResolvedValue(undefined),
      setUserEnabled: jest.fn().mockResolvedValue(undefined),
    };
    const accountMergeRequest = {
      findUnique: jest.fn().mockResolvedValue({
        id: 'merge-request',
        status: 'pending_score',
        selectedPrimaryEmail: 'primary@example.org',
        requesterUserId: primaryUserId,
        candidateUserId: secondaryUserId,
      }),
      update: jest.fn().mockResolvedValue({ status: 'completed' }),
    };
    const prisma = {
      accountMergeRequest,
      $transaction: jest.fn((callback: (tx: { accountMergeRequest: typeof accountMergeRequest }) => unknown) =>
        Promise.resolve(callback({ accountMergeRequest })),
      ),
    };
    const service = new AccountLinkingService(
      prisma as never,
      keycloakService as never,
      {} as never,
      {} as never,
      { add: jest.fn() } as never,
    );
    const serviceHarness = service as unknown as {
      scoreMergeCandidates: jest.Mock;
      transferFederatedIdentities: jest.Mock;
      transferLocalData: jest.Mock;
      createExternalMergeNotifications: jest.Mock;
    };

    serviceHarness.scoreMergeCandidates = jest.fn().mockResolvedValue({
      primaryUserId,
      secondaryUserId,
      scores: [],
      externalScores: [],
    });
    serviceHarness.transferFederatedIdentities = jest.fn().mockResolvedValue(undefined);
    serviceHarness.transferLocalData = jest.fn().mockResolvedValue(undefined);
    serviceHarness.createExternalMergeNotifications = jest.fn().mockResolvedValue([]);

    return { service, keycloakService };
  }

  it('adds the remaining user to Unesp when either merged account has a Unesp email', async () => {
    const { service, keycloakService } = createService(
      { email: ['primary@example.org'] },
      { email: ['former.account@unesp.br'] },
    );

    await service.processScoreAndMerge('merge-request');

    expect(keycloakService.addUserToGroupPath).toHaveBeenCalledWith(primaryUserId, '/Unesp');
  });

  it('does not add the remaining user to Unesp without a Unesp email', async () => {
    const { service, keycloakService } = createService(
      { email: ['primary@example.org'] },
      { email: ['secondary@example.org'] },
    );

    await service.processScoreAndMerge('merge-request');

    expect(keycloakService.addUserToGroupPath).not.toHaveBeenCalled();
  });
});
