import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { randomUUID } from 'crypto';
import type {
  AccountMergeRequest,
  AccountMergeUserScore,
  ExternalAccountMergeScore,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import {
  KeycloakFederatedIdentity,
  KeycloakService,
} from '../services/keycloak.service';
import { UserService } from '../services/user.service';
import { JwtService } from '../jwt/jwt.service';
import {
  ACCOUNT_MERGE_JOBS,
  ACCOUNT_MERGE_QUEUE,
  DeliverExternalNotificationJob,
  ScoreAndMergeJob,
} from './account-linking.queue';

interface ExternalMergeBackend {
  name: string;
  scoreUrl?: string;
  mergeUrl?: string;
  audience?: string;
}

interface MergeDecision {
  primaryUserId: string;
  secondaryUserId: string;
  scores: AccountMergeUserScore[];
  externalScores: ExternalAccountMergeScore[];
}

@Injectable()
export class AccountLinkingService {
  private readonly logger = new Logger(AccountLinkingService.name);
  private readonly mergeWindowMs = 15 * 60 * 1000;
  private readonly scoreTimeoutMs = 30 * 60 * 1000;
  private readonly initialRetryDelayMs = 10 * 60 * 1000;
  private readonly maxRetryDelayMs = 24 * 60 * 60 * 1000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    @InjectQueue(ACCOUNT_MERGE_QUEUE)
    private readonly accountMergeQueue: Queue<
      ScoreAndMergeJob | DeliverExternalNotificationJob
    >,
  ) {}

  async createMergeRequest(
    requesterUserId: string,
    candidateUserId: string,
  ): Promise<AccountMergeRequest> {
    if (requesterUserId === candidateUserId) {
      throw new BadRequestException('Account is already linked to this user');
    }

    const requester = await this.userService.findByKeycloakId(requesterUserId);
    const candidate = await this.userService.findByKeycloakId(candidateUserId);

    if (!requester || !candidate) {
      throw new NotFoundException('One of the accounts was not found');
    }

    const primaryEmailOptions = this.collectEmailOptions(
      await this.keycloakService.getUserAttributes(requesterUserId),
      await this.keycloakService.getUserAttributes(candidateUserId),
      requester.email,
      candidate.email,
    );

    const request = await this.prisma.accountMergeRequest.create({
      data: {
        requesterUserId,
        candidateUserId,
        scoreBreakdown: [],
        externalScores: [],
        expiresAt: new Date(Date.now() + this.mergeWindowMs),
      },
    });

    return this.toDto(request, primaryEmailOptions);
  }

  async getRequest(
    requestId: string,
    sessionUserId: string,
  ): Promise<AccountMergeRequest> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || !this.canReadRequest(request, sessionUserId)) {
      throw new NotFoundException('Merge request not found');
    }

    return this.toDto(
      request,
      undefined,
      await this.getNotificationSummary(request.id),
    );
  }

  async cancelRequest(requestId: string, sessionUserId: string): Promise<void> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.requesterUserId !== sessionUserId) {
      throw new NotFoundException('Merge request not found');
    }

    if (
      !['pending', 'pending_score', 'pending_merge'].includes(request.status)
    ) {
      return;
    }

    await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, requesterUserId: sessionUserId },
      data: { status: 'cancelled' },
    });
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
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.requesterUserId !== sessionUserId) {
      throw new NotFoundException('Merge request not found');
    }

    if (request.status !== 'pending') {
      throw new BadRequestException('Merge request is already being processed');
    }

    if (request.expiresAt.getTime() < Date.now()) {
      await this.prisma.accountMergeRequest.updateMany({
        where: { id: requestId, requesterUserId: sessionUserId },
        data: { status: 'expired' },
      });
      throw new BadRequestException('Merge request expired');
    }

    const emailOptions = await this.getEmailOptionsForRequest(request);
    const normalizedPrimaryEmail = primaryEmail.trim().toLowerCase();

    if (!emailOptions.includes(normalizedPrimaryEmail)) {
      throw new BadRequestException('Primary email must belong to one account');
    }

    await this.prisma.accountMergeRequest.updateMany({
      where: { id: requestId, requesterUserId: sessionUserId },
      data: {
        status: 'pending_score',
        selectedPrimaryEmail: normalizedPrimaryEmail,
      },
    });

    const updated = await this.prisma.accountMergeRequest.findFirstOrThrow({
      where: { id: requestId, requesterUserId: sessionUserId },
    });

    await this.accountMergeQueue.add(
      ACCOUNT_MERGE_JOBS.SCORE_AND_MERGE,
      { mergeRequestId: requestId },
      { jobId: `score:${requestId}`, removeOnComplete: true },
    );

    return {
      request: this.toDto(updated, emailOptions),
      primaryUserId: updated.primaryUserId || updated.requesterUserId,
      mergedUserId: updated.secondaryUserId || updated.candidateUserId,
      primaryEmail: normalizedPrimaryEmail,
      secondaryEmails: emailOptions.filter(
        (email) => email !== normalizedPrimaryEmail,
      ),
    };
  }

  async processScoreAndMerge(requestId: string): Promise<void> {
    const request = await this.prisma.accountMergeRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.status !== 'pending_score') {
      return;
    }

    if (!request.selectedPrimaryEmail) {
      await this.failMerge(requestId, 'Primary email was not selected');
      return;
    }

    try {
      const decision = await this.scoreMergeCandidates(
        request.requesterUserId,
        request.candidateUserId,
      );
      const primaryAttributes = await this.keycloakService.getUserAttributes(
        decision.primaryUserId,
      );
      const secondaryAttributes = await this.keycloakService.getUserAttributes(
        decision.secondaryUserId,
      );
      const emailOptions = await this.getEmailOptionsForRequest(request);
      const secondaryEmails = emailOptions.filter(
        (email) => email !== request.selectedPrimaryEmail,
      );

      await this.transferFederatedIdentities(
        decision.primaryUserId,
        decision.secondaryUserId,
      );

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
      await this.keycloakService.setUserEnabled(
        decision.secondaryUserId,
        false,
      );

      const { notifications, updated } = await this.prisma.$transaction(
        async (tx) => {
          await this.transferLocalData(
            tx,
            decision.primaryUserId,
            decision.secondaryUserId,
          );

          const notifications = await this.createExternalMergeNotifications(
            tx,
            {
              mergeRequestId: request.id,
              oldUserId: decision.secondaryUserId,
              newUserId: decision.primaryUserId,
            },
          );

          const updated = await tx.accountMergeRequest.update({
            where: { id: request.id },
            data: {
              status: notifications.length > 0 ? 'pending_merge' : 'completed',
              primaryUserId: decision.primaryUserId,
              secondaryUserId: decision.secondaryUserId,
              secondaryEmails,
              scoreBreakdown:
                decision.scores as unknown as Prisma.InputJsonValue,
              externalScores:
                decision.externalScores as unknown as Prisma.InputJsonValue,
              completedAt: notifications.length > 0 ? null : new Date(),
            },
          });

          return { notifications, updated };
        },
        {
          maxWait: 10_000,
          timeout: 30_000,
        },
      );

      let failedNotificationIds: string[] = [];

      try {
        const enqueueResults = await Promise.all(
          notifications.map(async (notification) => {
            try {
              await this.accountMergeQueue.add(
                ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
                { notificationId: notification.id },
                {
                  jobId: `notify:${notification.id}:0`,
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
          failedNotificationIds = failedEnqueues.map(
            ({ notificationId }) => notificationId,
          );
          throw new Error(
            failedEnqueues
              .map(({ notificationId, error }) => {
                const message =
                  error instanceof Error
                    ? error.message
                    : 'Unknown queue error';
                return `${notificationId}: ${message}`;
              })
              .join('; '),
          );
        }
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : 'Unknown queue error';

        this.logger.error(
          'Failed to enqueue account merge external notification jobs',
          {
            requestId,
            notificationIds: failedNotificationIds,
            errorMessage,
          },
        );

        if (failedNotificationIds.length > 0) {
          await this.prisma.accountMergeExternalNotification.updateMany({
            where: { id: { in: failedNotificationIds } },
            data: {
              status: 'failed',
              lastError: errorMessage,
              nextAttemptAt: null,
            },
          });
        }

        throw error;
      }

      if (updated.status === 'completed') {
        this.logger.log('Account merge completed without external backends', {
          requestId,
        });
      }
    } catch (error) {
      await this.failMerge(
        requestId,
        error instanceof Error ? error.message : 'Unknown merge error',
      );
      throw error;
    }
  }

  async deliverExternalNotification(notificationId: string): Promise<void> {
    const notification =
      await this.prisma.accountMergeExternalNotification.findUnique({
        where: { id: notificationId },
      });

    if (!notification || notification.status === 'completed') {
      return;
    }

    const attemptCount = notification.attemptCount + 1;

    try {
      const response = await fetch(notification.url, {
        method: 'POST',
        headers: await this.externalHeaders({
          name: notification.backendName,
          audience: notification.audience || undefined,
        }),
        body: JSON.stringify(notification.payload),
        signal: AbortSignal.timeout(30_000),
      });
      const responsePayload = await this.readJsonResponse(response);

      if (
        response.status === 200 &&
        this.isValidMergeAcknowledgement(responsePayload, {
          eventId: notification.eventId,
          oldUserId: notification.oldUserId,
          newUserId: notification.newUserId,
        })
      ) {
        await this.prisma.accountMergeExternalNotification.update({
          where: { id: notification.id },
          data: {
            status: 'completed',
            attemptCount,
            lastAttemptAt: new Date(),
            lastStatusCode: response.status,
            lastResponse: responsePayload as Prisma.InputJsonValue,
            lastError: null,
            nextAttemptAt: null,
            completedAt: new Date(),
          },
        });
        await this.completeMergeIfNotificationsFinished(
          notification.mergeRequestId,
        );
        return;
      }

      throw new Error(
        `Invalid acknowledgement: ${response.status} ${response.statusText}`,
      );
    } catch (error) {
      const delay = this.getNotificationRetryDelayMs(attemptCount);
      const nextAttemptAt = new Date(Date.now() + delay);

      await this.prisma.accountMergeExternalNotification.update({
        where: { id: notification.id },
        data: {
          status: 'pending',
          attemptCount,
          lastAttemptAt: new Date(),
          lastError: error instanceof Error ? error.message : 'Unknown error',
          nextAttemptAt,
        },
      });

      await this.accountMergeQueue.add(
        ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION,
        { notificationId: notification.id },
        {
          delay,
          jobId: `notify:${notification.id}:${attemptCount}`,
          removeOnComplete: true,
        },
      );
    }
  }

  private async scoreMergeCandidates(
    firstUserId: string,
    secondUserId: string,
  ): Promise<MergeDecision> {
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
    const [
      profile,
      attributes,
      discordLinks,
      approvedDocument,
      pendingDocument,
      groups,
    ] = await Promise.all([
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
    add(
      'Verified Discord accounts',
      Math.min(discordLinks.filter((link) => link.isVerified).length * 15, 45),
    );
    add('Approved student document', approvedDocument ? 20 : 0);
    add(
      'Pending student document',
      !approvedDocument && pendingDocument ? 5 : 0,
    );
    add('Keycloak group memberships', Math.min(groups.length * 3, 12));
    add(
      'Has secondary emails',
      this.parseEmails(attributes.secondary_emails).length * 2,
    );

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

  private async getExternalScores(
    userIds: string[],
  ): Promise<ExternalAccountMergeScore[]> {
    const backends = this.getExternalBackends().filter(
      (backend) => backend.scoreUrl,
    );

    return Promise.all(
      backends.map(async (backend) => {
        try {
          const response = await fetch(backend.scoreUrl!, {
            method: 'POST',
            headers: await this.externalHeaders(backend),
            body: JSON.stringify({ userIds }),
            signal: AbortSignal.timeout(this.scoreTimeoutMs),
          });

          if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
          }

          const payload = (await response.json()) as unknown;
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
    const backends = this.getExternalBackends().filter(
      (backend) => backend.mergeUrl,
    );

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
            url: backend.mergeUrl!,
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

  private async completeMergeIfNotificationsFinished(
    mergeRequestId: string,
  ): Promise<void> {
    const pending = await this.prisma.accountMergeExternalNotification.count({
      where: {
        mergeRequestId,
        status: { not: 'completed' },
      },
    });

    if (pending === 0) {
      await this.prisma.accountMergeRequest.update({
        where: { id: mergeRequestId },
        data: {
          status: 'completed',
          completedAt: new Date(),
        },
      });
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
  ): Promise<void> {
    this.logger.error('Account merge workflow failed', {
      requestId,
      errorMessage,
    });
    await this.prisma.accountMergeRequest.update({
      where: { id: requestId },
      data: {
        status: 'failed',
        errorMessage,
      },
    });
  }

  private getNotificationRetryDelayMs(attemptCount: number): number {
    return Math.min(
      this.initialRetryDelayMs * Math.max(attemptCount, 1) ** 2,
      this.maxRetryDelayMs,
    );
  }

  private async readJsonResponse(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) {
      return {};
    }

    try {
      return JSON.parse(text) as unknown;
    } catch {
      return { raw: text };
    }
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
    await tx.deleteAccountRequest.updateMany({
      where: { userId: secondaryUserId },
      data: { userId: primaryUserId },
    });

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

  private async transferFederatedIdentities(
    primaryUserId: string,
    secondaryUserId: string,
  ): Promise<void> {
    const [primaryIdentities, secondaryIdentities] = await Promise.all([
      this.keycloakService.getFederatedIdentities(primaryUserId),
      this.keycloakService.getFederatedIdentities(secondaryUserId),
    ]);

    const primaryKeys = new Set(
      primaryIdentities.map((identity) => this.identityKey(identity)),
    );

    for (const identity of secondaryIdentities) {
      if (primaryKeys.has(this.identityKey(identity))) {
        continue;
      }

      await this.moveFederatedIdentity(
        secondaryUserId,
        primaryUserId,
        identity,
      );
    }
  }

  private async moveFederatedIdentity(
    fromUserId: string,
    toUserId: string,
    identity: KeycloakFederatedIdentity,
  ): Promise<void> {
    await this.keycloakService.removeFederatedIdentity(
      fromUserId,
      identity.identityProvider,
    );

    try {
      await this.keycloakService.addFederatedIdentity(toUserId, identity);
    } catch (error) {
      await this.keycloakService
        .addFederatedIdentity(fromUserId, identity)
        .catch((restoreError) =>
          this.logger.error(
            'Failed to restore federated identity',
            restoreError,
          ),
        );
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

    const booleanKeys = [
      'isOnboarded',
      'isForeigner',
      'unespRoleVerified',
      'externalUserVerified',
      'fullNameLocked',
    ];

    for (const key of booleanKeys) {
      if (
        primaryAttributes[key]?.[0] === 'true' ||
        secondaryAttributes[key]?.[0] === 'true'
      ) {
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
    const [
      requesterAttributes,
      candidateAttributes,
      requesterBasic,
      candidateBasic,
    ] = await Promise.all([
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
              return parsed.filter(
                (item): item is string => typeof item === 'string',
              );
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
    return Array.from(
      new Set(values.map((value) => value.trim()).filter(Boolean)),
    );
  }

  private identityKey(identity: KeycloakFederatedIdentity): string {
    return `${identity.identityProvider}:${identity.userId}`;
  }

  private getExternalBackends(): ExternalMergeBackend[] {
    const raw =
      process.env.ACCOUNT_MERGE_EXTERNAL_BACKENDS ||
      process.env.ACCOUNT_LINKING_EXTERNAL_BACKENDS;

    if (!raw) {
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) {
        return [];
      }

      return parsed
        .filter((item): item is ExternalMergeBackend =>
          this.isExternalMergeBackend(item),
        )
        .map((item) => ({
          name: item.name,
          scoreUrl: item.scoreUrl,
          mergeUrl: item.mergeUrl,
          audience: item.audience,
        }));
    } catch (error) {
      this.logger.error('Invalid ACCOUNT_MERGE_EXTERNAL_BACKENDS JSON', error);
      return [];
    }
  }

  private async externalHeaders(
    backend: ExternalMergeBackend,
  ): Promise<Record<string, string>> {
    const token = await this.jwtService.getClientCredentialsToken({
      audience: backend.audience,
    });

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
  }

  private normalizeExternalScores(
    payload: unknown,
    userIds: string[],
  ): Record<string, number> {
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
        if (
          item &&
          typeof item === 'object' &&
          'userId' in item &&
          'score' in item
        ) {
          const record = item as Record<string, unknown>;
          if (
            typeof record.userId === 'string' &&
            typeof record.score === 'number'
          ) {
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
      this.uniqueStrings([
        ...scores.map((score) => score.email).filter(Boolean),
        ...request.secondaryEmails,
      ]);

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
    return (
      request.requesterUserId === sessionUserId ||
      request.primaryUserId === sessionUserId
    );
  }

  private isExternalMergeBackend(
    value: unknown,
  ): value is ExternalMergeBackend {
    if (!value || typeof value !== 'object') {
      return false;
    }

    const record = value as Record<string, unknown>;
    return (
      typeof record.name === 'string' &&
      (record.scoreUrl === undefined || typeof record.scoreUrl === 'string') &&
      (record.mergeUrl === undefined || typeof record.mergeUrl === 'string') &&
      (record.audience === undefined || typeof record.audience === 'string')
    );
  }
}
