import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  BACKGROUND_JOBS,
  BACKGROUND_JOBS_QUEUE,
  BACKGROUND_JOB_SCHEDULES,
  getBackgroundJobTimeZone,
  BackgroundJobData,
  RECURRING_JOB_OPTIONS,
} from './background-jobs.queue';

@Injectable()
export class BackgroundJobsService implements OnApplicationBootstrap {
  constructor(@InjectQueue(BACKGROUND_JOBS_QUEUE) private readonly queue: Queue<BackgroundJobData>) {}

  async onApplicationBootstrap(): Promise<void> {
    // One active maintenance job across all replicas, including retries.
    await this.queue.setGlobalConcurrency(1);
    for (const schedule of BACKGROUND_JOB_SCHEDULES) {
      await this.queue.upsertJobScheduler(
        schedule.name,
        { ...schedule.repeat, tz: getBackgroundJobTimeZone() },
        {
          name: schedule.name,
          data: {},
          opts: RECURRING_JOB_OPTIONS,
        },
      );
    }

    // Run on every deployment as well as periodically. Concurrent replica starts
    // share a deduplication key until this job completes or exhausts its retries.
    await this.queue.add(
      BACKGROUND_JOBS.USER_SCHEMA,
      {},
      {
        ...RECURRING_JOB_OPTIONS,
        deduplication: { id: 'user-schema-startup' },
      },
    );
  }
}
