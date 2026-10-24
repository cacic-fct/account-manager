import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { Queue } from 'bullmq';
import {
  getBackgroundJobTimeZone,
  BackgroundJobData,
  RECURRING_JOB_OPTIONS,
} from '../../background-jobs/background-jobs.queue';
import { DISCORD_MAINTENANCE_JOBS, DISCORD_MAINTENANCE_QUEUE } from './discord-maintenance.queue';

@Injectable()
export class DiscordMaintenanceService implements OnApplicationBootstrap {
  constructor(@InjectQueue(DISCORD_MAINTENANCE_QUEUE) private readonly queue: Queue<BackgroundJobData>) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.queue.setGlobalConcurrency(1);
    for (const schedule of [
      { name: DISCORD_MAINTENANCE_JOBS.SYNC_ROLES, pattern: '* * * * *' },
      { name: DISCORD_MAINTENANCE_JOBS.ENFORCE_POLICY, pattern: '15 4 * * *' },
    ]) {
      await this.queue.upsertJobScheduler(
        schedule.name,
        { pattern: schedule.pattern, tz: getBackgroundJobTimeZone() },
        {
          name: schedule.name,
          data: {},
          opts: RECURRING_JOB_OPTIONS,
        },
      );
    }
  }
}
