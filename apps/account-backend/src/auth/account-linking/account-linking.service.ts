import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import { filter, Observable, ReplaySubject, Subscription } from 'rxjs';
import type { AccountMergeRequest, AccountMergeUserScore, ExternalAccountMergeScore } from '@cacic/shared-types';
import { isUnespEmail } from '@cacic/shared-utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { KeycloakFederatedIdentity, KeycloakService } from '../services/keycloak.service';
import { UserService } from '../services/user.service';
import { EventManagerGrpcClient } from '../../grpc/event-manager-grpc.client';
import {
  ACCOUNT_MERGE_JOBS,
  ACCOUNT_MERGE_QUEUE,
  DeliverExternalNotificationJob,
  ScoreAndMergeJob,
} from './account-linking.queue';

interface ExternalMergeBackend {
  name: string;
  target: string;
  audience?: string;
  required: boolean;
}

interface MergeDecision {
  primaryUserId: string;
  secondaryUserId: string;
  scores: AccountMergeUserScore[];
  externalScores: ExternalAccountMergeScore[];
}

type MergeSagaStep =
  | 'prepared'
  | 'federated_identities_transferred'
  | 'primary_attributes_updated'
  | 'primary_group_updated'
  | 'secondary_attributes_updated'
  | 'secondary_disabled'
  | 'local_committed'
  | 'compensating'
  | 'compensation_pending'
  | 'compensated';

interface MergeExternalSnapshot {
  version: 1;
  primaryUserId: string;
  secondaryUserId: string;
  primaryAttributes: Record<string, string[]>;
  secondaryAttributes: Record<string, string[]>;
  primaryEnabled: boolean;
  secondaryEnabled: boolean;
  primaryFederatedIdentities: KeycloakFederatedIdentity[];
  secondaryFederatedIdentities: KeycloakFederatedIdentity[];
  primaryGroups: string[];
}

interface MergeSagaState {
  version: 1;
  step: MergeSagaStep;
  snapshot: MergeExternalSnapshot;
  compensationError?: string;
}

const UNESP_KEYCLOAK_GROUP_PATH = '/Unesp';
const ACCOUNT_MERGE_UPDATES_CHANNEL = 'account-merge-updates';

@Injectable()
export class AccountLinkingService {
  private readonly logger = new Logger(AccountLinkingService.name);
  private readonly mergeWindowMs = 15 * 60 * 1000;
  private readonly scoreTimeoutMs = 30 * 60 * 1000;
  private readonly initialRetryDelayMs = 10 * 60 * 1000;
  private readonly maxRetryDelayMs = 24 * 60 * 60 * 1000;
  private readonly externalNotificationLeaseMs = 15 * 60 * 1000;
  private readonly maxExternalNotificationAttempts = 5;
  private readonly mergeRecoveryAgeMs = 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly userService: UserService,
    private readonly redisService: RedisService,
    private readonly eventManagerGrpc: EventManagerGrpcClient,
    @InjectQueue(ACCOUNT_MERGE_QUEUE)
    private readonly accountMergeQueue: Queue<ScoreAndMergeJob | DeliverExternalNotificationJob>,
  ) {}

  async createMergeRequest(requesterUserId: string, candidateUserId: string): Promise<AccountMergeRequest> {
    if (requesterUserId === candidateUserId) {
      throw new BadRequestException('Account is already linked to this user');
    }

    const requester = await this.userService.findByKeycloakId(requesterUserId);
    const candidate = await this.userService.findByKeycloakId(candidateUserId);

    if (!requester || !candidate) {
      throw new NotFoundException('One of the accounts was not found');
    }

    await this.assertNoActiveDeletionRequests([requesterUserId, candidateUserId]);

    const primaryEmailOptions = this.collectEmailOptions(
      await this.keycloakService.getUserAttributes(requesterUserId),
      await this.keycloakService.getUserAttributes(candidateUserId),
      requester.email,
      candidate.email,
    );

    const request = await this.prisma.$transaction(async (tx) => {
      const pairKey = this.canonicalAccountPairKey(requesterUserId, candidateUserId);
      for (const userId of [requesterUserId, candidateUserId].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`account-merge-user:${userId}`}, 0))`;
      }
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${pairKey}, 0))`;

      const activeRequest = await tx.accountMergeRequest.findFirst({
        where: {
          status: { in: ['pending', 'pending_score', 'processing', 'pending_merge', 'completed'] },
          OR: [
            { requesterUserId: { in: [requesterUserId, candidateUserId] } },
            { candidateUserId: { in: [requesterUserId, candidateUserId] } },
            { primaryUserId: { in: [requesterUserId, candidateUserId] } },
            { secondaryUserId: { in: [requesterUserId, candidateUserId] } },
          ],
        },
        select: { id: true },
      });

      if (activeRequest) {
        throw new BadRequestException('One of these accounts already has an active merge request');
      }

      return tx.accountMergeRequest.create({
        data: {
          requesterUserId,
          candidateUserId,
          scoreBreakdown: [],
          externalScores: [],
          expiresAt: new Date(Date.now() + this.mergeWindowMs),
        },
      });
    });

    return this.toDto(request, primaryEmailOptions);
  }

  async createAdminMergeRequest(
    requesterUserId: string,
    candidateUserId: string,
    adminUserId: string,
  ): Promise<AccountMergeRequest> {
    const request = await this.createMergeRequest(requesterUserId, candidateUserId);
    this.logAdminAuditEvent('created', adminUserId, { requestId: request.id, requesterUserId, candidateUserId });
    return request;
  }

  async getRequest(requestId: string, sessionUserId: string): Promise<AccountMergeRequest> {
    return this.getMergeRequest(requestId, sessionUserId);
  }

  async getAdminRequest(requestId: string): Promise<AccountMergeRequest> {
    return this.getMergeRequest(requestId);
  }

  private async getMergeRequest(requestId: string, sessionUserId?: string): Promise<AccountMergeRequest> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || (sessionUserId && !this.canReadRequest(request, sessionUserId))) {
      throw new NotFoundException('Merge request not found');
    }

    const [primaryEmailOptions, notificationSummary] = await Promise.all([
      request.status === 'pending' ? this.getEmailOptionsForRequest(request) : undefined,
      this.getNotificationSummary(request.id),
    ]);

    return this.toDto(request, primaryEmailOptions, notificationSummary);
  }

  async openMergeRequestWatch(requestId: string): Promise<{
    updates: Observable<void>;
    close: () => void;
  }> {
    const updates = new ReplaySubject<void>(1);
    const channelUpdates = await this.redisService.subscribeWhenReady(ACCOUNT_MERGE_UPDATES_CHANNEL);
    const subscription: Subscription = channelUpdates
      .pipe(filter((updatedRequestId) => updatedRequestId === requestId))
      .subscribe({
        next: () => updates.next(),
        error: (error: unknown) => updates.error(error),
        complete: () => updates.complete(),
      });

    return {
      updates: updates.asObservable(),
      close: () => {
        subscription.unsubscribe();
        updates.complete();
      },
    };
  }

  async cancelRequest(requestId: string, sessionUserId: string): Promise<void> {
    await this.cancelMergeRequest(requestId, sessionUserId);
  }

  async cancelAdminRequest(requestId: string, adminUserId: string): Promise<void> {
    const cancelled = await this.cancelMergeRequest(requestId);
    if (cancelled) {
      this.logAdminAuditEvent('cancelled', adminUserId, { requestId });
    }
  }

  private async cancelMergeRequest(requestId: string, sessionUserId?: string): Promise<boolean> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || (sessionUserId && request.requesterUserId !== sessionUserId)) {
      throw new NotFoundException('Merge request not found');
    }

    if (!['pending', 'pending_score'].includes(request.status)) {
      return false;
    }

    const result = await this.prisma.accountMergeRequest.updateMany({
      where: {
        id: requestId,
        status: { in: ['pending', 'pending_score'] },
        ...(sessionUserId ? { requesterUserId: sessionUserId } : {}),
      },
      data: { status: 'cancelled' },
    });
    if (result.count > 0) {
      this.publishMergeUpdate(requestId);
      return true;
    }

    return false;
  }

  async confirmMerge(
    requestId: string,
    sessionUserId: string,
    primaryEmail: string,
  ): Promise<{
    request: AccountMergeRequest;
    primaryUserId: string;
    mergedUserId: string;
    primaryEmail: string;
    secondaryEmails: string[];
  }> {
    return this.confirmMergeRequest(requestId, primaryEmail, sessionUserId);
  }

  async confirmAdminMerge(
    requestId: string,
    primaryEmail: string,
    adminUserId: string,
  ): Promise<{
    request: AccountMergeRequest;
    primaryUserId: string;
    mergedUserId: string;
    primaryEmail: string;
    secondaryEmails: string[];
  }> {
    const result = await this.confirmMergeRequest(requestId, primaryEmail);
    this.logAdminAuditEvent('confirmed', adminUserId, { requestId });
    return result;
  }

  private logAdminAuditEvent(
    action: 'created' | 'confirmed' | 'cancelled',
    adminUserId: string,
    details: Record<string, string>,
  ): void {
    this.logger.log('Admin account merge audit event', { action, adminUserId, ...details });
  }

  private async confirmMergeRequest(
    requestId: string,
    primaryEmail: string,
    requesterUserId?: string,
  ): Promise<{
    request: AccountMergeRequest;
    primaryUserId: string;
    mergedUserId: string;
    primaryEmail: string;
    secondaryEmails: string[];
  }> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || (requesterUserId && request.requesterUserId !== requesterUserId)) {
      throw new NotFoundException('Merge request not found');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Merge request is already being processed');
    }

    if (request.expiresAt.getTime() < Date.now()) {
      await this.prisma.accountMergeRequest.updateMany({
        where: { id: requestId, ...(requesterUserId ? { requesterUserId } : {}) },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Merge request expired');
    }

    const emailOptions = await this.getEmailOptionsForRequest(request);
    const normalizedPrimaryEmail = primaryEmail.trim().toLowerCase();

    if (!emailOptions.includes(normalizedPrimaryEmail)) {
      throw new BadRequestException('Primary email must belong to one account');
    }

    const update = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: 'pending', ...(requesterUserId ? { requesterUserId } : {}) },
      data: {
        status: 'pending_score',
        selectedPrimaryEmail: normalizedPrimaryEmail,
      },
    });
    if (update.count === 0) {
      throw new BadRequestException('Merge request is already being processed');
    }

    const updated = await this.prisma.accountMergeRequest.findFirstOrThrow({
      where: { id: requestId, ...(requesterUserId ? { requesterUserId } : {}) },
    });

    await this.accountMergeQueue.add(
      ACCOUNT_MERGE_JOBS.SCORE_AND_MERGE,
      { mergeRequestId: requestId },
      { jobId: `score-${requestId}`, removeOnComplete: true },
    );
    this.publishMergeUpdate(requestId);

    return {
      request: this.toDto(updated, emailOptions),
      primaryUserId: updated.primaryUserId || updated.requesterUserId,
      mergedUserId: updated.secondaryUserId || updated.candidateUserId,
      primaryEmail: normalizedPrimaryEmail,
      secondaryEmails: emailOptions.filter((email) => email !== normalizedPrimaryEmail),
    };
  }

  async processScoreAndMerge(requestId: string): Promise<void> {
    const claimed = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: 'pending_score' },
      data: { status: 'processing' },
    });
    if (claimed.count === 0) {
      return;
    }

    const request = await this.prisma.accountMergeRequest.findUniqueOrThrow({ where: { id: requestId } });

    if (!request.selectedPrimaryEmail) {
      await this.failMerge(requestId, 'Primary email was not selected');
      return;
    }

    let sagaState: MergeSagaState | undefined;
    let sagaPersisted = false;

    try {
      const decision = await this.scoreMergeCandidates(request.requesterUserId, request.candidateUserId);
      const degradedReason = this.getRequiredExternalScoreFailure(decision.externalScores);
      if (degradedReason) {
        await this.failMerge(requestId, degradedReason, {
          scoreBreakdown: decision.scores as unknown as Prisma.InputJsonValue,
          externalScores: decision.externalScores as unknown as Prisma.InputJsonValue,
        });
        return;
      }

      await this.assertNoActiveDeletionRequests([decision.primaryUserId, decision.secondaryUserId]);

      const primaryAttributes = await this.keycloakService.getUserAttributes(decision.primaryUserId);
      const secondaryAttributes = await this.keycloakService.getUserAttributes(decision.secondaryUserId);
      const emailOptions = await this.getEmailOptionsForRequest(request);
      const secondaryEmails = emailOptions.filter((email) => email !== request.selectedPrimaryEmail);
      const snapshot = await this.captureMergeExternalSnapshot(
        decision.primaryUserId,
        decision.secondaryUserId,
        primaryAttributes,
        secondaryAttributes,
      );

      sagaState = { version: 1, step: 'prepared', snapshot };
      await this.persistMergeSagaState(requestId, sagaState, decision, secondaryEmails);
      sagaPersisted = true;

      await this.transferFederatedIdentities(decision.primaryUserId, decision.secondaryUserId);
      sagaState = await this.advanceMergeSagaState(requestId, sagaState, 'federated_identities_transferred');

      await this.keycloakService.updateUserAttributes(
        decision.primaryUserId,
        this.mergeAttributes(
          primaryAttributes,
          secondaryAttributes,
          decision.primaryUserId,
          decision.secondaryUserId,
          request.selectedPrimaryEmail,
          secondaryEmails,
        ),
        { skipValidation: true },
      );
      sagaState = await this.advanceMergeSagaState(requestId, sagaState, 'primary_attributes_updated');

      if (emailOptions.some(isUnespEmail)) {
        await this.keycloakService.addUserToGroupPath(decision.primaryUserId, UNESP_KEYCLOAK_GROUP_PATH);
      }
      sagaState = await this.advanceMergeSagaState(requestId, sagaState, 'primary_group_updated');

      await this.keycloakService.updateUserAttributes(
        decision.secondaryUserId,
        {
          ...secondaryAttributes,
          account_linked_to: [decision.primaryUserId],
          account_link_type: ['merge'],
          disabled_reason: ['account_merged'],
          updatedAt: [new Date().toISOString()],
        },
        { skipValidation: true },
      );
      sagaState = await this.advanceMergeSagaState(requestId, sagaState, 'secondary_attributes_updated');

      const { notifications, status } = await this.prisma.$transaction(
        async (tx) => {
          await this.transferLocalData(tx, decision.primaryUserId, decision.secondaryUserId);

          const notifications = await this.createExternalMergeNotifications(tx, {
            mergeRequestId: request.id,
            oldUserId: decision.secondaryUserId,
            newUserId: decision.primaryUserId,
          });

          const status = notifications.length > 0 ? 'pending_merge' : 'completed';
          const updated = await tx.accountMergeRequest.updateMany({
            where: { id: request.id, status: 'processing' },
            data: {
              status,
              primaryUserId: decision.primaryUserId,
              secondaryUserId: decision.secondaryUserId,
              secondaryEmails,
              scoreBreakdown: decision.scores as unknown as Prisma.InputJsonValue,
              externalScores: decision.externalScores as unknown as Prisma.InputJsonValue,
              mergeState: { ...sagaState, step: 'local_committed' } as unknown as Prisma.InputJsonValue,
              completedAt: notifications.length > 0 ? null : new Date(),
            },
          });

          if (updated.count === 0) {
            throw new Error('Merge request is no longer being processed');
          }

          return { notifications, status };
        },
        {
          maxWait: 10_000,
          timeout: 30_000,
        },
      );
      sagaState = { ...sagaState, step: 'local_committed' };

      try {
        await this.keycloakService.setUserEnabled(decision.secondaryUserId, false);
        const persistedDisabledState: MergeSagaState = { ...sagaState, step: 'secondary_disabled' };
        const persisted = await this.prisma.accountMergeRequest.updateMany({
          where: { id: requestId, status: { in: ['pending_merge', 'completed'] } },
          data: { mergeState: persistedDisabledState as unknown as Prisma.InputJsonValue },
        });
        if (persisted.count === 0) {
          throw new Error('Merge request terminal state changed before secondary disable was recorded');
        }
        sagaState = persistedDisabledState;
      } catch (error) {
        await this.failPostLocalMerge(requestId, error instanceof Error ? error.message : 'Unknown merge error');
        throw error;
      }
      this.publishMergeUpdate(requestId);

      try {
        const enqueueResults = await Promise.all(
          notifications.map(async (notification) => {
            try {
              const deliveryClaim = await this.claimExternalNotification(notification.id);

              if (!deliveryClaim) {
                return { notificationId: notification.id, queued: true };
              }

              await this.accountMergeQueue.add(
                ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
                { notificationId: notification.id, deliveryClaim },
                {
                  jobId: `notify-${notification.id}-0`,
                  removeOnComplete: true,
                },
              );
              return { notificationId: notification.id, queued: true };
            } catch (error: unknown) {
              return { notificationId: notification.id, queued: false, error };
            }
          }),
        );

        const failedEnqueues = enqueueResults.filter(
          (
            result,
          ): result is {
            notificationId: string;
            queued: false;
            error: unknown;
          } => !result.queued,
        );

        if (failedEnqueues.length > 0) {
          throw new Error(
            failedEnqueues
              .map(({ notificationId, error }) => {
                const message = error instanceof Error ? error.message : 'Unknown queue error';
                return `${notificationId}: ${message}`;
              })
              .join('; '),
          );
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown queue error';

        this.logger.error('Failed to enqueue account merge external notification jobs', {
          requestId,
          notificationIds: notifications.map(({ id }) => id),
          errorMessage,
        });
      }

      if (status === 'completed') {
        this.logger.debug('Account merge completed without external backends', {
          requestId,
        });
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown merge error';

      if (sagaState?.step === 'local_committed') {
        await this.failPostLocalMerge(requestId, errorMessage);
        throw error;
      }

      if (sagaState && sagaPersisted) {
        try {
          await this.compensateExternalMerge(requestId, sagaState);
        } catch (compensationError: unknown) {
          const compensationMessage =
            compensationError instanceof Error ? compensationError.message : 'Unknown compensation error';
          await this.failMerge(requestId, `${errorMessage}; compensation pending: ${compensationMessage}`);
          throw error;
        }
      }

      await this.failMerge(requestId, errorMessage);
      throw error;
    }
  }

  async deliverExternalNotification(notificationId: string, deliveryClaim?: string): Promise<void> {
    const claim = deliveryClaim || (await this.claimExternalNotification(notificationId));

    if (!claim) {
      return;
    }

    const notification = await this.prisma.accountMergeExternalNotification.findFirst({
      where: { id: notificationId, deliveryClaim: claim },
    });

    if (!notification || notification.status !== 'pending') {
      return;
    }

    const attemptCount = notification.attemptCount + 1;

    try {
      const responsePayload = await this.eventManagerGrpc.applyAccountMerge(
        notification.url,
        notification.audience || undefined,
        notification.payload as Record<string, unknown>,
      );

      if (
        this.isValidMergeAcknowledgement(responsePayload, {
          eventId: notification.eventId,
          oldUserId: notification.oldUserId,
          newUserId: notification.newUserId,
        })
      ) {
        const completed = await this.prisma.accountMergeExternalNotification.updateMany({
          where: { id: notification.id, deliveryClaim: claim },
          data: {
            status: 'completed',
            attemptCount,
            lastAttemptAt: new Date(),
            lastStatusCode: 0,
            lastResponse: responsePayload as Prisma.InputJsonValue,
            lastError: null,
            nextAttemptAt: null,
            completedAt: new Date(),
            deliveryClaim: null,
            claimExpiresAt: null,
          },
        });
        if (completed.count === 0) {
          return;
        }
        this.publishMergeUpdate(notification.mergeRequestId);
        await this.completeMergeIfNotificationsFinished(notification.mergeRequestId);
        return;
      }

      throw new Error('Invalid gRPC account merge acknowledgement.');
    } catch (error) {
      const delay = this.getNotificationRetryDelayMs(attemptCount);
      const nextAttemptAt = new Date(Date.now() + delay);

      if (attemptCount >= this.maxExternalNotificationAttempts) {
        const failed = await this.prisma.accountMergeExternalNotification.updateMany({
          where: { id: notification.id, deliveryClaim: claim },
          data: {
            status: 'failed',
            attemptCount,
            lastAttemptAt: new Date(),
            lastError: error instanceof Error ? error.message : 'Unknown error',
            nextAttemptAt: null,
            deliveryClaim: null,
            claimExpiresAt: null,
          },
        });
        if (failed.count === 0) {
          return;
        }
        this.logger.error('Account merge external notification reached terminal failure', {
          notificationId: notification.id,
          mergeRequestId: notification.mergeRequestId,
          attemptCount,
        });
        this.publishMergeUpdate(notification.mergeRequestId);
        await this.completeMergeIfNotificationsFinished(notification.mergeRequestId);
        return;
      }

      const retried = await this.prisma.accountMergeExternalNotification.updateMany({
        where: { id: notification.id, deliveryClaim: claim },
        data: {
          status: 'pending',
          attemptCount,
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Unknown error',
          nextAttemptAt,
          deliveryClaim: null,
          claimExpiresAt: null,
        },
      });
      if (retried.count === 0) {
        return;
      }
      this.publishMergeUpdate(notification.mergeRequestId);

      await this.accountMergeQueue.add(
        ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
        { notificationId: notification.id },
        {
          delay,
          jobId: `notify-${notification.id}-${attemptCount}`,
          removeOnComplete: true,
        },
      );
    }
  }

  async retryExternalNotification(mergeRequestId: string, notificationId: string): Promise<void> {
    const notification = await this.prisma.accountMergeExternalNotification.findFirst({
      where: { id: notificationId, mergeRequestId, status: 'failed' },
      select: { id: true },
    });

    if (!notification) {
      throw new NotFoundException('Failed merge notification not found');
    }

    const reset = await this.prisma.accountMergeExternalNotification.updateMany({
      where: { id: notification.id, status: 'failed' },
      data: {
        status: 'pending',
        attemptCount: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        lastStatusCode: null,
        lastResponse: Prisma.JsonNull,
        completedAt: null,
      },
    });

    if (reset.count === 0) {
      throw new BadRequestException('Merge notification is already being retried');
    }

    await this.prisma.accountMergeRequest.updateMany({
      where: { id: mergeRequestId, status: 'failed' },
      data: {
        status: 'pending_merge',
        completedAt: null,
        errorMessage: null,
      },
    });

    try {
      const deliveryClaim = await this.claimExternalNotification(notification.id);
      if (deliveryClaim) {
        await this.accountMergeQueue.add(
          ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
          { notificationId: notification.id, deliveryClaim },
          { jobId: `notify-${notification.id}-manual-${Date.now()}`, removeOnComplete: true },
        );
      }
    } catch (error: unknown) {
      this.logger.error('Failed to enqueue manually retried account merge notification', {
        mergeRequestId,
        notificationId: notification.id,
        error: error instanceof Error ? error.message : 'Unknown queue error',
      });
    }

    this.publishMergeUpdate(mergeRequestId);
  }

  @Cron('*/5 * * * *')
  async recoverPendingScoreMerges(): Promise<void> {
    const requests = await this.prisma.accountMergeRequest.findMany({
      where: { status: 'pending_score' },
      select: { id: true },
    });

    await Promise.all(
      requests.map(async ({ id }) => {
        try {
          await this.accountMergeQueue.add(
            ACCOUNT_MERGE_JOBS.SCORE_AND_MERGE,
            { mergeRequestId: id },
            { jobId: `score-${id}`, removeOnComplete: true },
          );
        } catch (error: unknown) {
          this.logger.error('Failed to recover account merge scoring job', {
            requestId: id,
            error: error instanceof Error ? error.message : 'Unknown queue error',
          });
        }
      }),
    );
  }

  @Cron('*/5 * * * *')
  async recoverPendingExternalNotifications(): Promise<void> {
    const notifications = await this.prisma.accountMergeExternalNotification.findMany({
      where: {
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: new Date() } }],
      },
      select: { id: true, attemptCount: true },
    });

    await Promise.all(
      notifications.map(async (notification) => {
        try {
          const deliveryClaim = await this.claimExternalNotification(notification.id);

          if (!deliveryClaim) {
            return;
          }

          await this.accountMergeQueue.add(
            ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
            { notificationId: notification.id, deliveryClaim },
            {
              jobId: `recover-notify-${notification.id}-${notification.attemptCount}`,
              removeOnComplete: true,
            },
          );
        } catch (error) {
          this.logger.error('Failed to recover account merge external notification job', {
            notificationId: notification.id,
            error: error instanceof Error ? error.message : 'Unknown queue error',
          });
        }
      }),
    );
  }

  @Cron('*/5 * * * *')
  async recoverInterruptedMerges(): Promise<void> {
    const cutoff = new Date(Date.now() - this.mergeRecoveryAgeMs);
    const requests = await this.prisma.accountMergeRequest.findMany({
      where: { status: { in: ['processing', 'pending_merge', 'completed', 'failed'] }, updatedAt: { lte: cutoff } },
      select: { id: true, mergeState: true },
    });

    await Promise.all(
      requests.map(async (request) => {
        const sagaState = this.parseMergeSagaState(request.mergeState);

        if (!sagaState) {
          const reset = await this.prisma.accountMergeRequest.updateMany({
            where: { id: request.id, status: 'processing' },
            data: { status: 'pending_score' },
          });
          if (reset.count === 1) {
            this.publishMergeUpdate(request.id);
          }
          return;
        }

        if (sagaState.step === 'local_committed') {
          await this.completeLocalMergeExternalStep(request.id, sagaState);
          return;
        }

        if (sagaState.step === 'compensated') {
          if (request.mergeState && request.mergeState !== null) {
            await this.prisma.accountMergeRequest.updateMany({
              where: { id: request.id, status: 'processing' },
              data: {
                status: 'failed',
                errorMessage: 'Merge worker completed compensation but did not finalize the request',
              },
            });
          }
          return;
        }

        await this.compensateInterruptedMerge(request.id, sagaState);
      }),
    );
  }

  private async claimExternalNotification(notificationId: string): Promise<string | null> {
    const deliveryClaim = randomUUID();
    const claimed = await this.prisma.accountMergeExternalNotification.updateMany({
      where: {
        id: notificationId,
        status: 'pending',
        nextAttemptAt: { lte: new Date() },
        OR: [{ claimExpiresAt: null }, { claimExpiresAt: { lte: new Date() } }],
      },
      data: {
        deliveryClaim,
        claimExpiresAt: new Date(Date.now() + this.externalNotificationLeaseMs),
      },
    });

    return claimed.count === 1 ? deliveryClaim : null;
  }

  private canonicalAccountPairKey(firstUserId: string, secondUserId: string): string {
    return [firstUserId, secondUserId].sort().join(':');
  }

  private async assertNoActiveDeletionRequests(userIds: string[]): Promise<void> {
    const uniqueUserIds = [...new Set(userIds)];
    const requests = await this.prisma.deleteAccountRequest.findMany({
      where: {
        userId: { in: uniqueUserIds },
        OR: [
          { status: { in: ['pending', 'processing', 'failed'] } },
          { scheduledHardDeleteAt: { not: null }, completedAt: null, cancelledAt: null },
        ],
      },
      select: { id: true, userId: true, status: true },
    });

    if (requests.length > 0) {
      throw new BadRequestException('Account merge is blocked while an account deletion request is active');
    }
  }

  private async captureMergeExternalSnapshot(
    primaryUserId: string,
    secondaryUserId: string,
    primaryAttributes: Record<string, string[]>,
    secondaryAttributes: Record<string, string[]>,
  ): Promise<MergeExternalSnapshot> {
    const [primaryBasic, secondaryBasic, primaryFederatedIdentities, secondaryFederatedIdentities, primaryGroups] =
      await Promise.all([
        this.keycloakService.getUserBasicInfo(primaryUserId),
        this.keycloakService.getUserBasicInfo(secondaryUserId),
        this.keycloakService.getFederatedIdentities(primaryUserId),
        this.keycloakService.getFederatedIdentities(secondaryUserId),
        this.keycloakService.getUserGroups(primaryUserId),
      ]);

    if (!primaryBasic || !secondaryBasic) {
      throw new Error('Unable to capture the external account state before merge');
    }

    return {
      version: 1,
      primaryUserId,
      secondaryUserId,
      primaryAttributes,
      secondaryAttributes,
      primaryEnabled: primaryBasic.enabled !== false,
      secondaryEnabled: secondaryBasic.enabled !== false,
      primaryFederatedIdentities,
      secondaryFederatedIdentities,
      primaryGroups,
    };
  }

  private async persistMergeSagaState(
    requestId: string,
    sagaState: MergeSagaState,
    decision: MergeDecision,
    secondaryEmails: string[],
  ): Promise<void> {
    const persisted = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: 'processing' },
      data: {
        primaryUserId: decision.primaryUserId,
        secondaryUserId: decision.secondaryUserId,
        secondaryEmails,
        scoreBreakdown: decision.scores as unknown as Prisma.InputJsonValue,
        externalScores: decision.externalScores as unknown as Prisma.InputJsonValue,
        mergeState: sagaState as unknown as Prisma.InputJsonValue,
      },
    });

    if (persisted.count === 0) {
      throw new Error('Merge request is no longer being processed');
    }
  }

  private async advanceMergeSagaState(
    requestId: string,
    sagaState: MergeSagaState,
    step: MergeSagaStep,
  ): Promise<MergeSagaState> {
    const nextState: MergeSagaState = { ...sagaState, step };
    const updated = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: 'processing' },
      data: { mergeState: nextState as unknown as Prisma.InputJsonValue },
    });

    if (updated.count === 0) {
      throw new Error('Merge request is no longer being processed');
    }

    return nextState;
  }

  private async compensateExternalMerge(requestId: string, sagaState: MergeSagaState): Promise<void> {
    const compensating: MergeSagaState = { ...sagaState, step: 'compensating', compensationError: undefined };
    await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: { in: ['processing', 'failed'] } },
      data: { mergeState: compensating as unknown as Prisma.InputJsonValue },
    });

    try {
      await this.restoreMergeExternalSnapshot(sagaState.snapshot);
    } catch (error: unknown) {
      const compensationError = error instanceof Error ? error.message : 'Unknown compensation error';
      const pending: MergeSagaState = {
        ...compensating,
        step: 'compensation_pending',
        compensationError,
      };
      await this.prisma.accountMergeRequest.updateMany({
        where: { id: requestId, status: { in: ['processing', 'failed'] } },
        data: { mergeState: pending as unknown as Prisma.InputJsonValue },
      });
      throw error;
    }

    const compensated: MergeSagaState = { ...compensating, step: 'compensated' };
    await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: { in: ['processing', 'failed'] } },
      data: { mergeState: compensated as unknown as Prisma.InputJsonValue },
    });
  }

  private async compensateInterruptedMerge(requestId: string, sagaState: MergeSagaState): Promise<void> {
    try {
      await this.compensateExternalMerge(requestId, sagaState);
      await this.failMerge(requestId, 'Merge worker interrupted; external changes were compensated before retry');
    } catch (error: unknown) {
      await this.failMerge(
        requestId,
        `Merge worker interrupted; compensation pending: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  private async failPostLocalMerge(requestId: string, errorMessage: string): Promise<void> {
    const failed = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: { in: ['pending_merge', 'completed'] } },
      data: {
        status: 'failed',
        errorMessage: `Local merge committed but secondary account disable is pending: ${errorMessage}`,
      },
    });
    if (failed.count > 0) {
      this.publishMergeUpdate(requestId);
    }
  }

  private async completeLocalMergeExternalStep(requestId: string, sagaState: MergeSagaState): Promise<void> {
    try {
      await this.keycloakService.setUserEnabled(sagaState.snapshot.secondaryUserId, false);
      const completedState: MergeSagaState = { ...sagaState, step: 'secondary_disabled' };
      const [pendingNotifications, failedNotifications] = await Promise.all([
        this.prisma.accountMergeExternalNotification.count({
          where: { mergeRequestId: requestId, status: 'pending' },
        }),
        this.prisma.accountMergeExternalNotification.count({
          where: { mergeRequestId: requestId, status: 'failed' },
        }),
      ]);
      const nextStatus = pendingNotifications > 0 ? 'pending_merge' : failedNotifications > 0 ? 'failed' : 'completed';
      const updated = await this.prisma.accountMergeRequest.updateMany({
        where: { id: requestId, status: { in: ['pending_merge', 'completed', 'failed'] } },
        data: {
          status: nextStatus,
          completedAt: pendingNotifications > 0 ? null : new Date(),
          errorMessage:
            failedNotifications > 0
              ? `One or more external merge notifications failed after ${this.maxExternalNotificationAttempts} attempts; manual retry required.`
              : null,
          mergeState: completedState as unknown as Prisma.InputJsonValue,
        },
      });
      if (updated.count > 0) {
        this.publishMergeUpdate(requestId);
      }
    } catch (error: unknown) {
      await this.failPostLocalMerge(requestId, this.errorMessage(error));
    }
  }

  private parseMergeSagaState(value: Prisma.JsonValue | null | undefined): MergeSagaState | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    const candidate = value as Record<string, unknown>;
    if (candidate.version !== 1 || typeof candidate.step !== 'string' || !candidate.snapshot) {
      return null;
    }

    return candidate as unknown as MergeSagaState;
  }

  private async restoreMergeExternalSnapshot(snapshot: MergeExternalSnapshot): Promise<void> {
    const errors: string[] = [];

    try {
      await this.restoreFederatedIdentities(snapshot);
    } catch (error: unknown) {
      errors.push(`federated identities: ${this.errorMessage(error)}`);
    }

    try {
      await this.keycloakService.updateUserAttributes(snapshot.primaryUserId, snapshot.primaryAttributes, {
        skipValidation: true,
      });
    } catch (error: unknown) {
      errors.push(`primary attributes: ${this.errorMessage(error)}`);
    }

    try {
      await this.keycloakService.updateUserAttributes(snapshot.secondaryUserId, snapshot.secondaryAttributes, {
        skipValidation: true,
      });
    } catch (error: unknown) {
      errors.push(`secondary attributes: ${this.errorMessage(error)}`);
    }

    try {
      const currentGroups = await this.keycloakService.getUserGroups(snapshot.primaryUserId);
      const hadUnesp = snapshot.primaryGroups.some((group) => this.isUnespGroup(group));
      const hasUnesp = currentGroups.some((group) => this.isUnespGroup(group));
      if (hadUnesp && !hasUnesp) {
        await this.keycloakService.addUserToGroupPath(snapshot.primaryUserId, UNESP_KEYCLOAK_GROUP_PATH);
      } else if (!hadUnesp && hasUnesp) {
        await this.keycloakService.removeUserFromGroupPath(snapshot.primaryUserId, UNESP_KEYCLOAK_GROUP_PATH);
      }
    } catch (error: unknown) {
      errors.push(`primary group: ${this.errorMessage(error)}`);
    }

    try {
      await this.keycloakService.setUserEnabled(snapshot.primaryUserId, snapshot.primaryEnabled);
    } catch (error: unknown) {
      errors.push(`primary enabled state: ${this.errorMessage(error)}`);
    }

    try {
      await this.keycloakService.setUserEnabled(snapshot.secondaryUserId, snapshot.secondaryEnabled);
    } catch (error: unknown) {
      errors.push(`secondary enabled state: ${this.errorMessage(error)}`);
    }

    if (errors.length > 0) {
      throw new Error(errors.join('; '));
    }
  }

  private async restoreFederatedIdentities(snapshot: MergeExternalSnapshot): Promise<void> {
    const [currentPrimary, currentSecondary] = await Promise.all([
      this.keycloakService.getFederatedIdentities(snapshot.primaryUserId),
      this.keycloakService.getFederatedIdentities(snapshot.secondaryUserId),
    ]);
    const desiredPrimary = new Map(
      snapshot.primaryFederatedIdentities.map((identity) => [this.identityKey(identity), identity]),
    );
    const desiredSecondary = new Map(
      snapshot.secondaryFederatedIdentities.map((identity) => [this.identityKey(identity), identity]),
    );

    for (const identity of currentPrimary) {
      const key = this.identityKey(identity);
      if (!desiredPrimary.has(key) && desiredSecondary.has(key)) {
        await this.moveFederatedIdentity(snapshot.primaryUserId, snapshot.secondaryUserId, identity);
      }
    }

    for (const identity of currentSecondary) {
      const key = this.identityKey(identity);
      if (!desiredSecondary.has(key) && desiredPrimary.has(key)) {
        await this.moveFederatedIdentity(snapshot.secondaryUserId, snapshot.primaryUserId, identity);
      }
    }

    const [restoredPrimary, restoredSecondary] = await Promise.all([
      this.keycloakService.getFederatedIdentities(snapshot.primaryUserId),
      this.keycloakService.getFederatedIdentities(snapshot.secondaryUserId),
    ]);
    const restoredPrimaryKeys = new Set(restoredPrimary.map((identity) => this.identityKey(identity)));
    const restoredSecondaryKeys = new Set(restoredSecondary.map((identity) => this.identityKey(identity)));

    for (const identity of snapshot.primaryFederatedIdentities) {
      if (!restoredPrimaryKeys.has(this.identityKey(identity))) {
        await this.keycloakService.addFederatedIdentity(snapshot.primaryUserId, identity);
      }
    }
    for (const identity of snapshot.secondaryFederatedIdentities) {
      if (!restoredSecondaryKeys.has(this.identityKey(identity))) {
        await this.keycloakService.addFederatedIdentity(snapshot.secondaryUserId, identity);
      }
    }
  }

  private getRequiredExternalScoreFailure(externalScores: ExternalAccountMergeScore[]): string | null {
    const requiredFailures = externalScores.filter((score) => {
      if (!score.error) {
        return false;
      }

      return this.getExternalBackends().find((backend) => backend.name === score.backend)?.required ?? true;
    });

    if (requiredFailures.length === 0) {
      return null;
    }

    return `Required external merge scoring unavailable: ${requiredFailures
      .map((score) => `${score.backend}: ${score.error}`)
      .join('; ')}`;
  }

  private errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private isUnespGroup(group: string): boolean {
    return group === UNESP_KEYCLOAK_GROUP_PATH || group === UNESP_KEYCLOAK_GROUP_PATH.slice(1);
  }

  private async scoreMergeCandidates(firstUserId: string, secondUserId: string): Promise<MergeDecision> {
    const [firstScore, secondScore, externalScores] = await Promise.all([
      this.scoreUser(firstUserId),
      this.scoreUser(secondUserId),
      this.getExternalScores([firstUserId, secondUserId]),
    ]);

    for (const external of externalScores) {
      for (const score of [firstScore, secondScore]) {
        const points = external.scores[score.userId] || 0;
        if (points !== 0) {
          score.contributions.push({
            source: external.backend,
            label: 'External backend score',
            points,
          });
          score.score += points;
        }
      }
    }

    const sorted = [firstScore, secondScore].sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      return a.userId === firstUserId ? -1 : 1;
    });

    return {
      primaryUserId: sorted[0].userId,
      secondaryUserId: sorted[1].userId,
      scores: [firstScore, secondScore],
      externalScores,
    };
  }

  private async scoreUser(userId: string): Promise<AccountMergeUserScore> {
    const [profile, attributes, discordLinks, approvedDocument, pendingDocument, groups] = await Promise.all([
      this.userService.findByKeycloakId(userId),
      this.keycloakService.getUserAttributes(userId),
      this.prisma.discordLink.findMany({
        where: { userId, deleted: false },
      }),
      this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'approved' },
      }),
      this.prisma.studentVerificationDocument.findFirst({
        where: { userId, status: 'pending' },
      }),
      this.keycloakService.getUserGroups(userId).catch(() => []),
    ]);

    const contributions: AccountMergeUserScore['contributions'] = [];
    const add = (label: string, points: number, source = 'CACiC') => {
      if (points > 0) {
        contributions.push({ source, label, points });
      }
    };

    add('Completed onboarding', profile?.isOnboarded ? 25 : 0);
    add('Full name provided', profile?.fullname ? 15 : 0);
    add('Phone provided', profile?.phone ? 10 : 0);
    add('Identity document provided', profile?.identityDocument ? 10 : 0);
    add('Profile picture available', profile?.picture ? 5 : 0);
    add('Enrollment number provided', profile?.enrollmentNumber ? 8 : 0);
    add('Unesp role selected', profile?.unespRole ? 6 : 0);
    add('Student status verified', profile?.unespRoleVerified ? 30 : 0);
    add('External user verified', profile?.externalUserVerified ? 15 : 0);
    add('Full name locked by verification', profile?.fullNameLocked ? 5 : 0);
    add('Verified Discord accounts', Math.min(discordLinks.filter((link) => link.isVerified).length * 15, 45));
    add('Approved student document', approvedDocument ? 20 : 0);
    add('Pending student document', !approvedDocument && pendingDocument ? 5 : 0);
    add('Keycloak group memberships', Math.min(groups.length * 3, 12));
    add('Has secondary emails', this.parseEmails(attributes.secondary_emails).length * 2);

    const createdAt = profile?.createdAt?.getTime();
    if (createdAt && createdAt < Date.now() - 180 * 24 * 60 * 60 * 1000) {
      add('Established account age', 3);
    }

    return {
      userId,
      email: profile?.email || attributes.email?.[0] || '',
      displayName: profile?.displayName || profile?.fullname || '',
      score: contributions.reduce((sum, item) => sum + item.points, 0),
      contributions,
    };
  }

  private async getExternalScores(userIds: string[]): Promise<ExternalAccountMergeScore[]> {
    const backends = this.getExternalBackends();

    return Promise.all(
      backends.map(async (backend) => {
        try {
          const payload = await this.eventManagerGrpc.scoreAccounts(
            backend.target,
            backend.audience,
            userIds,
            this.scoreTimeoutMs,
          );
          return {
            backend: backend.name,
            scores: this.normalizeExternalScores(payload, userIds),
          };
        } catch (error) {
          return {
            backend: backend.name,
            scores: {},
            error: error instanceof Error ? error.message : 'Unknown error',
          };
        }
      }),
    );
  }

  private async createExternalMergeNotifications(
    tx: Prisma.TransactionClient,
    payload: {
      mergeRequestId: string;
      oldUserId: string;
      newUserId: string;
    },
  ) {
    const occurredAt = new Date().toISOString();
    const backends = this.getExternalBackends();

    return Promise.all(
      backends.map((backend) => {
        const eventId = randomUUID();
        const eventPayload = {
          eventId,
          type: 'account.merged',
          oldUserId: payload.oldUserId,
          newUserId: payload.newUserId,
          occurredAt,
        };

        return tx.accountMergeExternalNotification.create({
          data: {
            mergeRequestId: payload.mergeRequestId,
            eventId,
            backendName: backend.name,
            url: backend.target,
            audience: backend.audience,
            oldUserId: payload.oldUserId,
            newUserId: payload.newUserId,
            payload: eventPayload,
            nextAttemptAt: new Date(),
          },
        });
      }),
    );
  }

  private async completeMergeIfNotificationsFinished(mergeRequestId: string): Promise<void> {
    const [pending, failed] = await Promise.all([
      this.prisma.accountMergeExternalNotification.count({
        where: {
          mergeRequestId,
          status: 'pending',
        },
      }),
      this.prisma.accountMergeExternalNotification.count({
        where: {
          mergeRequestId,
          status: 'failed',
        },
      }),
    ]);

    if (pending > 0) {
      return;
    }

    const updated = await this.prisma.accountMergeRequest.updateMany({
      where: {
        id: mergeRequestId,
        status: 'pending_merge',
      },
      data: {
        status: failed > 0 ? 'failed' : 'completed',
        completedAt: new Date(),
        errorMessage:
          failed > 0
            ? `One or more external merge notifications failed after ${this.maxExternalNotificationAttempts} attempts; manual retry required.`
            : null,
      },
    });

    if (updated.count > 0) {
      this.publishMergeUpdate(mergeRequestId);
    }
  }

  private async getNotificationSummary(mergeRequestId: string): Promise<{
    pending: number;
    completed: number;
    failed: number;
  }> {
    const [pending, completed, failed] = await Promise.all([
      this.prisma.accountMergeExternalNotification.count({
        where: { mergeRequestId, status: 'pending' },
      }),
      this.prisma.accountMergeExternalNotification.count({
        where: { mergeRequestId, status: 'completed' },
      }),
      this.prisma.accountMergeExternalNotification.count({
        where: { mergeRequestId, status: 'failed' },
      }),
    ]);

    return { pending, completed, failed };
  }

  private async failMerge(
    requestId: string,
    errorMessage: string,
    details: {
      scoreBreakdown?: Prisma.InputJsonValue;
      externalScores?: Prisma.InputJsonValue;
    } = {},
  ): Promise<void> {
    this.logger.error('Account merge workflow failed', {
      requestId,
      errorMessage,
    });
    const failed = await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, status: 'processing' },
      data: {
        status: 'failed',
        errorMessage,
        ...details,
      },
    });
    if (failed.count > 0) {
      this.publishMergeUpdate(requestId);
    }
  }

  private publishMergeUpdate(requestId: string): void {
    void this.redisService.publish(ACCOUNT_MERGE_UPDATES_CHANNEL, requestId).catch((error: unknown) => {
      this.logger.error('Failed to publish account merge update', { requestId, error });
    });
  }

  private getNotificationRetryDelayMs(attemptCount: number): number {
    return Math.min(this.initialRetryDelayMs * Math.max(attemptCount, 1) ** 2, this.maxRetryDelayMs);
  }

  private isValidMergeAcknowledgement(
    payload: unknown,
    expected: { eventId: string; oldUserId: string; newUserId: string },
  ): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const ack = payload as Record<string, unknown>;
    return (
      ack.eventId === expected.eventId &&
      ack.type === 'account.merged' &&
      ack.oldUserId === expected.oldUserId &&
      ack.newUserId === expected.newUserId &&
      ack.status === 'success'
    );
  }

  private async transferLocalData(
    tx: Prisma.TransactionClient,
    primaryUserId: string,
    secondaryUserId: string,
  ): Promise<void> {
    await tx.discordLink.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });
    await tx.studentVerificationDocument.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });
    await tx.studentVerificationLog.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });
    await tx.lgpdRequest.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });

    // Permission grants and entity memberships are additive ownership records;
    // transfer them before the grants' relation metadata is evaluated by readers.
    await tx.studentEntityMembership.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });
    await tx.keycloakPermissionGrant.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });

    const [primaryRoleOverride, secondaryRoleOverride] = await Promise.all([
      tx.discordManagedRoleOverride.findUnique({ where: { userId: primaryUserId } }),
      tx.discordManagedRoleOverride.findUnique({ where: { userId: secondaryUserId } }),
    ]);

    if (secondaryRoleOverride && !primaryRoleOverride) {
      await tx.discordManagedRoleOverride.update({
        where: { userId: secondaryUserId },
        data: { userId: primaryUserId },
      });
    } else if (secondaryRoleOverride && primaryRoleOverride) {
      // A user has at most one managed-role override. The existing primary
      // override is authoritative, so remove the secondary-owned row rather
      // than leaving an orphaned owner or violating the unique user key.
      await tx.discordManagedRoleOverride.delete({ where: { userId: secondaryUserId } });
    }

    const [primaryPrivacy, secondaryPrivacy] = await Promise.all([
      tx.privacySetting.findUnique({ where: { userId: primaryUserId } }),
      tx.privacySetting.findUnique({ where: { userId: secondaryUserId } }),
    ]);

    if (secondaryPrivacy && !primaryPrivacy) {
      await tx.privacySetting.update({
        where: { userId: secondaryUserId },
        data: { userId: primaryUserId },
      });
    } else if (secondaryPrivacy && primaryPrivacy) {
      await tx.privacySetting.update({
        where: { userId: primaryUserId },
        data: {
          metadata: {
            mergedFrom: secondaryUserId,
            primaryMetadata: primaryPrivacy.metadata,
            secondaryMetadata: secondaryPrivacy.metadata,
          },
        },
      });
      await tx.privacySetting.delete({ where: { userId: secondaryUserId } });
    }
  }

  private async transferFederatedIdentities(primaryUserId: string, secondaryUserId: string): Promise<void> {
    const [primaryIdentities, secondaryIdentities] = await Promise.all([
      this.keycloakService.getFederatedIdentities(primaryUserId),
      this.keycloakService.getFederatedIdentities(secondaryUserId),
    ]);

    const primaryKeys = new Set(primaryIdentities.map((identity) => this.identityKey(identity)));

    for (const identity of secondaryIdentities) {
      if (primaryKeys.has(this.identityKey(identity))) {
        continue;
      }

      await this.moveFederatedIdentity(secondaryUserId, primaryUserId, identity);
    }
  }

  private async moveFederatedIdentity(
    fromUserId: string,
    toUserId: string,
    identity: KeycloakFederatedIdentity,
  ): Promise<void> {
    await this.keycloakService.removeFederatedIdentity(fromUserId, identity.identityProvider);

    try {
      await this.keycloakService.addFederatedIdentity(toUserId, identity);
    } catch (error) {
      await this.keycloakService
        .addFederatedIdentity(fromUserId, identity)
        .catch((restoreError) => this.logger.error('Failed to restore federated identity', restoreError));
      throw error;
    }
  }

  private mergeAttributes(
    primaryAttributes: Record<string, string[]>,
    secondaryAttributes: Record<string, string[]>,
    primaryUserId: string,
    secondaryUserId: string,
    primaryEmail: string,
    secondaryEmails: string[],
  ): Record<string, string[]> {
    const merged: Record<string, string[]> = { ...primaryAttributes };
    const fillIfBlank = (key: string) => {
      const primaryValue = merged[key]?.[0]?.trim();
      const secondaryValue = secondaryAttributes[key]?.[0]?.trim();
      if (!primaryValue && secondaryValue) {
        merged[key] = [secondaryValue];
      }
    };

    [
      'fullName',
      'displayName',
      'phone',
      'identity-document',
      'passportCountry',
      'enrollmentNumber',
      'unespRole',
      'picture',
      'createdAt',
    ].forEach(fillIfBlank);

    const booleanKeys = ['isOnboarded', 'isForeigner', 'unespRoleVerified', 'externalUserVerified', 'fullNameLocked'];

    for (const key of booleanKeys) {
      if (primaryAttributes[key]?.[0] === 'true' || secondaryAttributes[key]?.[0] === 'true') {
        merged[key] = ['true'];
      }
    }

    merged.email = [primaryEmail];
    merged.username = [primaryEmail];
    merged.secondary_emails = secondaryEmails;
    merged.account_linked_from = this.uniqueStrings([
      ...this.parseEmails(primaryAttributes.account_linked_from),
      secondaryUserId,
    ]);
    merged.account_link_type = ['merge'];
    merged.updatedAt = [new Date().toISOString()];

    if (primaryUserId === secondaryUserId) {
      delete merged.account_linked_from;
    }

    return merged;
  }

  private collectEmailOptions(
    firstAttributes: Record<string, string[]>,
    secondAttributes: Record<string, string[]>,
    ...fallbackEmails: Array<string | undefined>
  ): string[] {
    return this.uniqueStrings(
      [
        ...this.parseEmails(firstAttributes.email),
        ...this.parseEmails(firstAttributes.secondary_emails),
        ...this.parseEmails(secondAttributes.email),
        ...this.parseEmails(secondAttributes.secondary_emails),
        ...fallbackEmails,
      ].filter((email): email is string => !!email),
    );
  }

  private async getEmailOptionsForRequest(request: {
    requesterUserId: string;
    candidateUserId: string;
  }): Promise<string[]> {
    const [requesterAttributes, candidateAttributes, requesterBasic, candidateBasic] = await Promise.all([
      this.keycloakService.getUserAttributes(request.requesterUserId),
      this.keycloakService.getUserAttributes(request.candidateUserId),
      this.keycloakService.getUserBasicInfo(request.requesterUserId),
      this.keycloakService.getUserBasicInfo(request.candidateUserId),
    ]);

    return this.collectEmailOptions(
      requesterAttributes,
      candidateAttributes,
      requesterBasic?.email,
      candidateBasic?.email,
    );
  }

  private parseEmails(values?: string[]): string[] {
    if (!values?.length) {
      return [];
    }

    return values
      .flatMap((value) => {
        const trimmed = value.trim();
        if (!trimmed) {
          return [];
        }

        if (trimmed.startsWith('[')) {
          try {
            const parsed = JSON.parse(trimmed) as unknown;
            if (Array.isArray(parsed)) {
              return parsed.filter((item): item is string => typeof item === 'string');
            }
          } catch {
            return [trimmed];
          }
        }

        return trimmed.split(',').map((item) => item.trim());
      })
      .map((email) => email.toLowerCase())
      .filter(Boolean);
  }

  private uniqueStrings(values: string[]): string[] {
    return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
  }

  private identityKey(identity: KeycloakFederatedIdentity): string {
    return `${identity.identityProvider}:${identity.userId}`;
  }

  private getExternalBackends(): ExternalMergeBackend[] {
    const raw = process.env.ACCOUNT_MERGE_GRPC_BACKENDS;

    if (!raw) {
      if (process.env.NODE_ENV === 'production' && process.env.ACCOUNT_MERGE_ALLOW_NO_BACKENDS !== 'true') {
        throw new Error(
          'ACCOUNT_MERGE_GRPC_BACKENDS is required in production; set ACCOUNT_MERGE_ALLOW_NO_BACKENDS=true to opt out explicitly',
        );
      }
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        throw new Error('ACCOUNT_MERGE_GRPC_BACKENDS must be a JSON array');
      }
      if (!parsed.every((item) => this.isExternalMergeBackend(item))) {
        throw new Error('ACCOUNT_MERGE_GRPC_BACKENDS contains an invalid backend entry');
      }
      const backends = parsed.map((item: ExternalMergeBackend) => ({
        name: item.name,
        target: item.target,
        audience: item.audience,
        required: item.required !== false,
      }));
      if (new Set(backends.map((backend) => backend.name)).size !== backends.length) {
        throw new Error('ACCOUNT_MERGE_GRPC_BACKENDS contains duplicate backend names');
      }
      return backends;
    } catch (error) {
      this.logger.error('Invalid ACCOUNT_MERGE_GRPC_BACKENDS configuration', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private normalizeExternalScores(payload: unknown, userIds: string[]): Record<string, number> {
    const scores: Record<string, number> = {};

    if (payload && typeof payload === 'object' && 'scores' in payload) {
      const value = payload.scores;
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        for (const userId of userIds) {
          const rawScore = (value as Record<string, unknown>)[userId];
          if (typeof rawScore === 'number' && Number.isFinite(rawScore)) {
            scores[userId] = rawScore;
          }
        }
      }
    }

    if (Array.isArray(payload)) {
      for (const item of payload) {
        if (item && typeof item === 'object' && 'userId' in item && 'score' in item) {
          const record = item as Record<string, unknown>;
          if (typeof record.userId === 'string' && typeof record.score === 'number') {
            scores[record.userId] = record.score;
          }
        }
      }
    }

    return scores;
  }

  private toDto(
    request: {
      id: string;
      requesterUserId: string;
      candidateUserId: string;
      primaryUserId: string | null;
      secondaryUserId: string | null;
      selectedPrimaryEmail: string | null;
      secondaryEmails: string[];
      status: string;
      scoreBreakdown: Prisma.JsonValue;
      externalScores: Prisma.JsonValue | null;
      expiresAt: Date;
      completedAt: Date | null;
      createdAt: Date;
    },
    primaryEmailOptions?: string[],
    notificationSummary: {
      pending: number;
      completed: number;
      failed: number;
    } = { pending: 0, completed: 0, failed: 0 },
  ): AccountMergeRequest {
    const scores = Array.isArray(request.scoreBreakdown)
      ? (request.scoreBreakdown as unknown as AccountMergeUserScore[])
      : [];
    const externalScores = Array.isArray(request.externalScores)
      ? (request.externalScores as unknown as ExternalAccountMergeScore[])
      : [];
    const emailOptions =
      primaryEmailOptions ||
      this.uniqueStrings([...scores.map((score) => score.email).filter(Boolean), ...request.secondaryEmails]);

    return {
      id: request.id,
      status: request.status as AccountMergeRequest['status'],
      requesterUserId: request.requesterUserId,
      candidateUserId: request.candidateUserId,
      primaryUserId: request.primaryUserId || request.requesterUserId,
      secondaryUserId: request.secondaryUserId || request.candidateUserId,
      primaryEmailOptions: emailOptions,
      selectedPrimaryEmail: request.selectedPrimaryEmail || undefined,
      secondaryEmails: request.secondaryEmails,
      notificationSummary,
      scores,
      externalScores,
      expiresAt: request.expiresAt.toISOString(),
      completedAt: request.completedAt?.toISOString(),
      createdAt: request.createdAt.toISOString(),
    };
  }

  private canReadRequest(
    request: {
      requesterUserId: string;
      primaryUserId: string | null;
    },
    sessionUserId: string,
  ): boolean {
    return request.requesterUserId === sessionUserId || request.primaryUserId === sessionUserId;
  }

  private isExternalMergeBackend(value: unknown): value is ExternalMergeBackend {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.name === 'string' &&
      typeof record.target === 'string' &&
      (record.audience === undefined || typeof record.audience === 'string') &&
      (record.required === undefined || typeof record.required === 'boolean')
    );
  }
}
