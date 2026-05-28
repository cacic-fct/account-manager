import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AccountLinkingService } from './account-linking.service';
import {
  ACCOUNT_MERGE_JOBS,
  ACCOUNT_MERGE_QUEUE,
  DeliverExternalNotificationJob,
  ScoreAndMergeJob,
} from './account-linking.queue';

@Processor(ACCOUNT_MERGE_QUEUE)
export class AccountLinkingProcessor extends WorkerHost {
  private readonly logger = new Logger(AccountLinkingProcessor.name);

  constructor(private readonly accountLinkingService: AccountLinkingService) {
    super();
  }

  async process(
    job: Job<ScoreAndMergeJob | DeliverExternalNotificationJob>,
  ): Promise<void> {
    switch (job.name) {
      case ACCOUNT_MERGE_JOBS.SCORE_AND_MERGE:
        await this.accountLinkingService.processScoreAndMerge(
          (job.data as ScoreAndMergeJob).mergeRequestId,
        );
        return;
      case ACCOUNT_MERGE_JOBS.DELIVER_EXTERNAL_NOTIFICATION:
        await this.accountLinkingService.deliverExternalNotification(
          (job.data as DeliverExternalNotificationJob).notificationId,
        );
        return;
      default:
        this.logger.warn(`Unknown account merge job: ${job.name}`);
    }
  }
}
