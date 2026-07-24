import { AccountLinkingService } from './account-linking.service';
import { Subject } from 'rxjs';

describe('AccountLinkingService', () => {
  const primaryUserId = 'primary-user';
  const secondaryUserId = 'secondary-user';

  function createConfirmationService(expiresAt = new Date(Date.now() + 60_000)) {
    const request = {
      id: 'merge-request',
      status: 'pending' as const,
      requesterUserId: 'requester-user',
      candidateUserId: 'candidate-user',
      primaryUserId: null,
      secondaryUserId: null,
      selectedPrimaryEmail: null,
      secondaryEmails: [],
      scoreBreakdown: [],
      externalScores: [],
      expiresAt,
      completedAt: null,
      createdAt: new Date('2026-07-23T11:45:00.000Z'),
    };
    const updatedRequest = {
      ...request,
      status: 'pending_score' as const,
      selectedPrimaryEmail: 'requester@example.org',
    };
    const accountMergeRequest = {
      findUnique: jest.fn().mockResolvedValue(request),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      findFirstOrThrow: jest.fn().mockResolvedValue(updatedRequest),
    };
    const keycloakService = {
      getUserAttributes: jest.fn().mockResolvedValue({}),
      getUserBasicInfo: jest.fn((userId: string) =>
        Promise.resolve({
          email: userId === request.requesterUserId ? 'requester@example.org' : 'candidate@example.org',
        }),
      ),
    };
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const redisService = { publish: jest.fn().mockResolvedValue(undefined), subscribe: jest.fn() };
    const service = new AccountLinkingService(
      { accountMergeRequest } as never,
      keycloakService as never,
      {} as never,
      {} as never,
      redisService as never,
      queue as never,
    );

    return { service, accountMergeRequest, redisService };
  }

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
    const mergeUpdates = new Subject<string>();
    const redisService = {
      publish: jest.fn(async (_channel: string, requestId: string) => mergeUpdates.next(requestId)),
      subscribe: jest.fn(() => mergeUpdates.asObservable()),
    };
    const service = new AccountLinkingService(
      prisma as never,
      keycloakService as never,
      {} as never,
      {} as never,
      redisService as never,
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

    return { service, keycloakService, redisService };
  }

  it('adds the remaining user to Unesp when either merged account has a Unesp email', async () => {
    const { service, keycloakService } = createService(
      { email: ['primary@example.org'] },
      { email: ['former.account@unesp.br'] },
    );

    await service.processScoreAndMerge('merge-request');

    expect(keycloakService.addUserToGroupPath).toHaveBeenCalledWith(primaryUserId, '/Unesp');
  });

  it('publishes a merge update when the worker completes a merge', async () => {
    const { service } = createService({ email: ['primary@example.org'] }, { email: ['secondary@example.org'] });
    const updates: void[] = [];
    const subscription = service.watchMergeRequest('merge-request').subscribe(() => updates.push(undefined));

    await service.processScoreAndMerge('merge-request');
    subscription.unsubscribe();

    expect(updates).toEqual([undefined]);
  });

  it('does not add the remaining user to Unesp without a Unesp email', async () => {
    const { service, keycloakService } = createService(
      { email: ['primary@example.org'] },
      { email: ['secondary@example.org'] },
    );

    await service.processScoreAndMerge('merge-request');

    expect(keycloakService.addUserToGroupPath).not.toHaveBeenCalled();
  });

  it('publishes merge updates through the shared Redis channel', async () => {
    const { service, redisService } = createService(
      { email: ['primary@example.org'] },
      { email: ['secondary@example.org'] },
    );

    await service.processScoreAndMerge('merge-request');

    expect(redisService.publish).toHaveBeenCalledWith('account-merge-updates', 'merge-request');
  });

  it('scopes confirmation updates to the requester for a user-owned request', async () => {
    const { service, accountMergeRequest } = createConfirmationService();

    await service.confirmMerge('merge-request', 'requester-user', 'requester@example.org');

    expect(accountMergeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'merge-request', requesterUserId: 'requester-user' },
      data: { status: 'pending_score', selectedPrimaryEmail: 'requester@example.org' },
    });
    expect(accountMergeRequest.findFirstOrThrow).toHaveBeenCalledWith({
      where: { id: 'merge-request', requesterUserId: 'requester-user' },
    });
  });

  it('does not scope administrator confirmation updates to the requester', async () => {
    const { service, accountMergeRequest } = createConfirmationService();

    await service.confirmAdminMerge('merge-request', 'requester@example.org', 'admin-user');

    expect(accountMergeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'merge-request' },
      data: { status: 'pending_score', selectedPrimaryEmail: 'requester@example.org' },
    });
    expect(accountMergeRequest.findFirstOrThrow).toHaveBeenCalledWith({ where: { id: 'merge-request' } });
  });

  it('records administrator audit events only after the delegated operation succeeds', async () => {
    const { service } = createConfirmationService();
    const serviceHarness = service as unknown as {
      createMergeRequest: jest.Mock;
      confirmMergeRequest: jest.Mock;
      logAdminAuditEvent: jest.Mock;
    };
    serviceHarness.createMergeRequest = jest.fn().mockResolvedValue({ id: 'merge-request' });
    serviceHarness.confirmMergeRequest = jest.fn().mockResolvedValue({ request: { id: 'merge-request' } });
    serviceHarness.logAdminAuditEvent = jest.fn();

    await service.createAdminMergeRequest('requester-user', 'candidate-user', 'admin-user');
    await service.confirmAdminMerge('merge-request', 'requester@example.org', 'admin-user');

    expect(serviceHarness.logAdminAuditEvent.mock.invocationCallOrder[0]).toBeGreaterThan(
      serviceHarness.createMergeRequest.mock.invocationCallOrder[0],
    );
    expect(serviceHarness.logAdminAuditEvent.mock.invocationCallOrder[1]).toBeGreaterThan(
      serviceHarness.confirmMergeRequest.mock.invocationCallOrder[0],
    );
    expect(serviceHarness.logAdminAuditEvent).toHaveBeenNthCalledWith(1, 'created', 'admin-user', {
      requestId: 'merge-request',
      requesterUserId: 'requester-user',
      candidateUserId: 'candidate-user',
    });
  });

  it('does not record administrator cancellation for a no-op request', async () => {
    const { service, accountMergeRequest } = createConfirmationService();
    const serviceHarness = service as unknown as {
      logAdminAuditEvent: jest.Mock;
    };
    accountMergeRequest.findUnique.mockResolvedValue({ id: 'merge-request', status: 'completed' });
    serviceHarness.logAdminAuditEvent = jest.fn();

    await service.cancelAdminRequest('merge-request', 'admin-user');

    expect(serviceHarness.logAdminAuditEvent).not.toHaveBeenCalled();
  });

  it('does not record administrator audit events when delegated creation or confirmation fails', async () => {
    const { service } = createConfirmationService();
    const serviceHarness = service as unknown as {
      createMergeRequest: jest.Mock;
      confirmMergeRequest: jest.Mock;
      logAdminAuditEvent: jest.Mock;
    };
    serviceHarness.createMergeRequest = jest.fn().mockRejectedValue(new Error('creation failed'));
    serviceHarness.confirmMergeRequest = jest.fn().mockRejectedValue(new Error('confirmation failed'));
    serviceHarness.logAdminAuditEvent = jest.fn();

    await expect(service.createAdminMergeRequest('requester-user', 'candidate-user', 'admin-user')).rejects.toThrow(
      'creation failed',
    );
    await expect(service.confirmAdminMerge('merge-request', 'requester@example.org', 'admin-user')).rejects.toThrow(
      'confirmation failed',
    );

    expect(serviceHarness.logAdminAuditEvent).not.toHaveBeenCalled();
  });

  it('keeps the requester filter when an owned merge request expires', async () => {
    const { service, accountMergeRequest } = createConfirmationService(new Date(Date.now() - 60_000));

    await expect(service.confirmMerge('merge-request', 'requester-user', 'requester@example.org')).rejects.toThrow(
      'Merge request expired',
    );

    expect(accountMergeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'merge-request', requesterUserId: 'requester-user' },
      data: { status: 'expired' },
    });
  });

  it('omits the requester filter when an administrator expires a merge request', async () => {
    const { service, accountMergeRequest } = createConfirmationService(new Date(Date.now() - 60_000));

    await expect(service.confirmAdminMerge('merge-request', 'requester@example.org', 'admin-user')).rejects.toThrow(
      'Merge request expired',
    );

    expect(accountMergeRequest.updateMany).toHaveBeenCalledWith({
      where: { id: 'merge-request' },
      data: { status: 'expired' },
    });
  });
});
