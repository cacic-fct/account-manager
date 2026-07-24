import { AccountManagerPermission, AccountMergeRequest } from '@cacic/shared-types';
import { Subject } from 'rxjs';
import { ACCOUNT_PERMISSIONS_KEY } from '../guards/account-permission.guard';
import { AccountLinkingService } from './account-linking.service';
import { AdminAccountMergeController } from './admin-account-merge.controller';

const mergeRequest: AccountMergeRequest = {
  id: 'merge-request-1',
  status: 'pending',
  requesterUserId: 'first-user',
  candidateUserId: 'second-user',
  primaryUserId: 'first-user',
  secondaryUserId: 'second-user',
  primaryEmailOptions: ['first@example.com', 'second@example.com'],
  secondaryEmails: [],
  notificationSummary: { pending: 0, completed: 0, failed: 0 },
  scores: [],
  externalScores: [],
  expiresAt: '2026-07-23T12:00:00.000Z',
  createdAt: '2026-07-23T11:45:00.000Z',
};

describe('AdminAccountMergeController', () => {
  const accountLinkingService = {
    createAdminMergeRequest: jest.fn(),
    getAdminRequest: jest.fn(),
    confirmAdminMerge: jest.fn(),
    cancelAdminRequest: jest.fn(),
    watchMergeRequest: jest.fn(),
  };
  const controller = new AdminAccountMergeController(accountLinkingService as unknown as AccountLinkingService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires the super-admin permission for every account merge operation', () => {
    for (const handler of [
      AdminAccountMergeController.prototype.createMergeRequest,
      AdminAccountMergeController.prototype.getMergeRequest,
      AdminAccountMergeController.prototype.confirmMerge,
      AdminAccountMergeController.prototype.cancelMerge,
    ]) {
      expect(Reflect.getMetadata(ACCOUNT_PERMISSIONS_KEY, handler)).toEqual({
        permissions: [AccountManagerPermission.SuperAdmin],
        mode: 'any',
      });
    }
  });

  it('delegates the create, confirm, read, and cancel workflow to the shared merge service', async () => {
    accountLinkingService.createAdminMergeRequest.mockResolvedValue(mergeRequest);
    accountLinkingService.getAdminRequest.mockResolvedValue(mergeRequest);
    accountLinkingService.confirmAdminMerge.mockResolvedValue({
      request: mergeRequest,
      primaryUserId: 'first-user',
      mergedUserId: 'second-user',
      primaryEmail: 'first@example.com',
      secondaryEmails: ['second@example.com'],
    });

    await expect(
      controller.createMergeRequest(
        { requesterUserId: 'first-user', candidateUserId: 'second-user' },
        { user: { keycloakId: 'admin-user' } } as never,
      ),
    ).resolves.toEqual(mergeRequest);
    await expect(controller.getMergeRequest(mergeRequest.id)).resolves.toEqual(mergeRequest);
    await expect(
      controller.confirmMerge(mergeRequest.id, { primaryEmail: 'first@example.com' }, { user: { keycloakId: 'admin-user' } } as never),
    ).resolves.toMatchObject({
      primaryUserId: 'first-user',
    });
    await expect(controller.cancelMerge(mergeRequest.id, { user: { keycloakId: 'admin-user' } } as never)).resolves.toEqual({
      success: true,
    });

    expect(accountLinkingService.createAdminMergeRequest).toHaveBeenCalledWith('first-user', 'second-user', 'admin-user');
    expect(accountLinkingService.getAdminRequest).toHaveBeenCalledWith(mergeRequest.id);
    expect(accountLinkingService.confirmAdminMerge).toHaveBeenCalledWith(mergeRequest.id, 'first@example.com', 'admin-user');
    expect(accountLinkingService.cancelAdminRequest).toHaveBeenCalledWith(mergeRequest.id, 'admin-user');
  });

  it('streams a complete initial request followed by field-level deltas', async () => {
    const updates = new Subject<void>();
    const processingRequest = { ...mergeRequest, status: 'pending_merge' as const };
    accountLinkingService.getAdminRequest.mockResolvedValueOnce(mergeRequest).mockResolvedValueOnce(processingRequest);
    accountLinkingService.watchMergeRequest.mockReturnValue(updates);

    const stream = await controller.streamMergeRequest(mergeRequest.id);
    const events: Array<{ data: unknown }> = [];
    const subscription = stream.subscribe((event) => events.push(event));

    updates.next();
    await new Promise(setImmediate);

    expect(events).toEqual([
      { data: mergeRequest },
      { data: { id: mergeRequest.id, status: 'pending_merge' } },
    ]);
    subscription.unsubscribe();
  });
});
