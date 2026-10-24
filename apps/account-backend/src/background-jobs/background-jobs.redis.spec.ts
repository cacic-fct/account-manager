import { randomUUID } from 'node:crypto';
import { Job, Queue, QueueEvents, Worker } from 'bullmq';
import { AccountLinkingService } from '../auth/account-linking/account-linking.service';
import { UserSchemaReconciliationService } from '../auth/services/user-schema-reconciliation.service';
import { LgpdCleanupService } from '../common/services/lgpd-cleanup.service';
import { DocumentManagementService } from '../student-verification/services/document-management.service';
import { BackgroundJobsProcessor } from './background-jobs.processor';
import { BACKGROUND_JOBS, BACKGROUND_JOB_SCHEDULES, BackgroundJobData } from './background-jobs.queue';
import { BackgroundJobsService } from './background-jobs.service';

// Opt in against a test Redis. All keys use a unique namespace; no shared keys are flushed.
const describeRedis = process.env.BACKGROUND_JOBS_REDIS_TEST === '1' ? describe : describe.skip;

describeRedis('Background maintenance with Redis', () => {
  it('deduplicates replica startup, retains schedules, retries failures, and serializes workers globally', async () => {
    const connection = {
      host: process.env.REDIS_HOST || '127.0.0.1',
      port: Number(process.env.REDIS_PORT || 6379),
      ...(process.env.REDIS_PASSWORD && { password: process.env.REDIS_PASSWORD }),
    };
    const name = `test-maintenance-${randomUUID()}`;
    const queue = new Queue<BackgroundJobData>(name, { connection });
    const events = new QueueEvents(name, { connection });
    const workers: Worker[] = [];
    let active = 0;
    let maximumActive = 0;
    let startupAttempts = 0;
    let processingStartup = false;
    const schema = {
      reconcile: jest.fn(() => {
        if (processingStartup) {
          startupAttempts += 1;
          if (startupAttempts === 1) {
            return Promise.reject(new Error('temporary failure'));
          }
        }
        return Promise.resolve();
      }),
    };
    const processor = new BackgroundJobsProcessor(
      schema as unknown as UserSchemaReconciliationService,
      {
        recoverPendingScoreMerges: () => Promise.resolve(),
        recoverPendingExternalNotifications: () => Promise.resolve(),
        recoverInterruptedMerges: () => Promise.resolve(),
      } as AccountLinkingService,
      { cleanupExpiredLgpdFiles: () => Promise.resolve() } as LgpdCleanupService,
      { cleanupExpiredDocuments: () => Promise.resolve() } as DocumentManagementService,
    );

    try {
      await events.waitUntilReady();
      await Promise.all([
        new BackgroundJobsService(queue).onApplicationBootstrap(),
        new BackgroundJobsService(queue).onApplicationBootstrap(),
      ]);
      expect(await queue.getJobSchedulers()).toHaveLength(BACKGROUND_JOB_SCHEDULES.length);
      const jobs = await queue.getJobs(['waiting', 'delayed']);
      const startupJobs = jobs.filter((job) => job.opts.deduplication?.id === 'user-schema-startup');
      expect(startupJobs).toHaveLength(1);

      for (let replica = 0; replica < 2; replica += 1) {
        workers.push(
          new Worker<BackgroundJobData>(
            name,
            async (job) => {
              active += 1;
              maximumActive = Math.max(maximumActive, active);
              try {
                await new Promise((resolve) => setTimeout(resolve, 20));
                processingStartup = job.opts.deduplication?.id === 'user-schema-startup';
                await processor.process(job);
              } finally {
                active -= 1;
              }
            },
            { connection, concurrency: 4 },
          ),
        );
      }
      const otherJob = await queue.add(BACKGROUND_JOBS.DOCUMENT_RETENTION, {});
      await Promise.all([startupJobs[0].waitUntilFinished(events, 15_000), otherJob.waitUntilFinished(events, 15_000)]);
      expect(startupAttempts).toBe(2);
      expect(maximumActive).toBe(1);
      expect(await queue.getJobSchedulers()).toHaveLength(BACKGROUND_JOB_SCHEDULES.length);
      await expect(processor.process({ name: 'unknown' } as Job<BackgroundJobData>)).rejects.toThrow('Unknown');
    } finally {
      await Promise.all(workers.map((worker) => worker.close()));
      await events.close();
      await queue.obliterate({ force: true });
      await queue.close();
    }
  }, 25_000);
});
