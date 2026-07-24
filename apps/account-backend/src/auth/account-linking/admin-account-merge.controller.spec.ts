import { AccountManagerPermission, AccountMergeRequest } from '@cacic/shared-types';
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
  };
  const controller = new AdminAccountMergeController(accountLinkingService as unknown as AccountLinkingService);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires the super-admin permission for every account merge operation', () => {
    for (const handler of [
      controller.createMergeRequest,
      controller.getMergeRequest,
      controller.confirmMerge,
      controller.cancelMerge,
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
      controller.createMergeRequest({ requesterUserId: 'first-user', candidateUserId: 'second-user' }),
    ).resolves.toEqual(mergeRequest);
    await expect(controller.getMergeRequest(mergeRequest.id)).resolves.toEqual(mergeRequest);
    await expect(controller.confirmMerge(mergeRequest.id, { primaryEmail: 'first@example.com' })).resolves.toMatchObject({
      primaryUserId: 'first-user',
    });
    await expect(controller.cancelMerge(mergeRequest.id)).resolves.toEqual({ success: true });

    expect(accountLinkingService.createAdminMergeRequest).toHaveBeenCalledWith('first-user', 'second-user');
    expect(accountLinkingService.getAdminRequest).toHaveBeenCalledWith(mergeRequest.id);
    expect(accountLinkingService.confirmAdminMerge).toHaveBeenCalledWith(mergeRequest.id, 'first@example.com');
    expect(accountLinkingService.cancelAdminRequest).toHaveBeenCalledWith(mergeRequest.id);
  });
});
