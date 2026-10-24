import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { AccountLinkingService } from '../auth/account-linking/account-linking.service';
import { UserSchemaReconciliationService } from '../auth/services/user-schema-reconciliation.service';
import { LgpdCleanupService } from '../common/services/lgpd-cleanup.service';
import { DocumentManagementService } from '../student-verification/services/document-management.service';
import { BACKGROUND_JOBS, BACKGROUND_JOBS_QUEUE, BackgroundJobData } from './background-jobs.queue';

@Processor(BACKGROUND_JOBS_QUEUE, { concurrency: 1 })
export class BackgroundJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(BackgroundJobsProcessor.name);

  constructor(
    private readonly userSchema: UserSchemaReconciliationService,
    private readonly accountLinking: AccountLinkingService,
    private readonly lgpdCleanup: LgpdCleanupService,
    private readonly documents: DocumentManagementService,
  ) {
    super();
  }

  async process(job: Job<BackgroundJobData>): Promise<void> {
    switch (job.name) {
      case BACKGROUND_JOBS.USER_SCHEMA:
        return this.userSchema.reconcile();
      case BACKGROUND_JOBS.MERGE_SCORING:
        return this.accountLinking.recoverPendingScoreMerges();
      case BACKGROUND_JOBS.MERGE_NOTIFICATIONS:
        return this.accountLinking.recoverPendingExternalNotifications();
      case BACKGROUND_JOBS.INTERRUPTED_MERGES:
        return this.accountLinking.recoverInterruptedMerges();
      case BACKGROUND_JOBS.LGPD_CLEANUP:
        return this.lgpdCleanup.cleanupExpiredLgpdFiles();
      case BACKGROUND_JOBS.DOCUMENT_RETENTION:
        return this.documents.cleanupExpiredDocuments();
      default:
        throw new Error(`Unknown background maintenance job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BackgroundJobData> | undefined, error: Error): void {
    this.logger.error('Background maintenance job failed', { jobId: job?.id, jobName: job?.name, error });
  }
}
