import type { MessageEvent } from '@nestjs/common';
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
    retryExternalNotification: jest.fn(),
    openMergeRequestWatch: jest.fn(),
  };
  const controller = new AdminAccountMergeController(accountLinkingService as unknown as AccountLinkingService);

  function getControllerHandler(method: string): object {
    return Object.getOwnPropertyDescriptor(AdminAccountMergeController.prototype, method)?.value as object;
  }

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('requires the super-admin permission for every account merge operation', () => {
    for (const handler of [
      'createMergeRequest',
      'getMergeRequest',
      'streamMergeRequest',
      'confirmMerge',
      'cancelMerge',
      'retryNotification',
    ].map(getControllerHandler)) {
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
      controller.createMergeRequest({ requesterUserId: 'first-user', candidateUserId: 'second-user' }, {
        user: { keycloakId: 'admin-user' },
      } as never),
    ).resolves.toEqual(mergeRequest);
    await expect(controller.getMergeRequest(mergeRequest.id)).resolves.toEqual(mergeRequest);
    await expect(
      controller.confirmMerge(mergeRequest.id, { primaryEmail: 'first@example.com' }, {
        user: { keycloakId: 'admin-user' },
      } as never),
    ).resolves.toMatchObject({
      primaryUserId: 'first-user',
    });
    await expect(
      controller.cancelMerge(mergeRequest.id, { user: { keycloakId: 'admin-user' } } as never),
    ).resolves.toEqual({ success: true });

    expect(accountLinkingService.createAdminMergeRequest).toHaveBeenCalledWith(
      'first-user',
      'second-user',
      'admin-user',
    );
    expect(accountLinkingService.getAdminRequest).toHaveBeenCalledWith(mergeRequest.id);
    expect(accountLinkingService.confirmAdminMerge).toHaveBeenCalledWith(
      mergeRequest.id,
      'first@example.com',
      'admin-user',
    );
    expect(accountLinkingService.cancelAdminRequest).toHaveBeenCalledWith(mergeRequest.id, 'admin-user');
  });

  it('delegates a failed external notification retry to the merge service', async () => {
    await expect(controller.retryNotification(mergeRequest.id, 'notification-1')).resolves.toEqual({ success: true });

    expect(accountLinkingService.retryExternalNotification).toHaveBeenCalledWith(mergeRequest.id, 'notification-1');
  });

  it('streams a complete initial request followed by field-level deltas', async () => {
    const updates = new Subject<void>();
    const close = jest.fn();
    const processingRequest = { ...mergeRequest, status: 'pending_merge' as const };
    accountLinkingService.getAdminRequest
      .mockResolvedValueOnce(mergeRequest)
      .mockResolvedValueOnce(mergeRequest)
      .mockResolvedValueOnce(processingRequest);
    accountLinkingService.openMergeRequestWatch.mockResolvedValue({ updates, close });

    const stream = await controller.streamMergeRequest(mergeRequest.id);
    const events: MessageEvent[] = [];
    const subscription = stream.subscribe((event) => events.push(event));

    await new Promise(setImmediate);
    updates.next();
    await new Promise(setImmediate);

    expect(events).toEqual([{ data: mergeRequest }, { data: { id: mergeRequest.id, status: 'pending_merge' } }]);
    subscription.unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('does not open a Redis watch for a terminal request', async () => {
    accountLinkingService.getAdminRequest.mockResolvedValue({ ...mergeRequest, status: 'completed' });

    const stream = await controller.streamMergeRequest(mergeRequest.id);
    const events: MessageEvent[] = [];
    stream.subscribe((event) => events.push(event));

    expect(events).toEqual([{ data: { ...mergeRequest, status: 'completed' } }]);
    expect(accountLinkingService.openMergeRequestWatch).not.toHaveBeenCalled();
  });
});
