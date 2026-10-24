import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { BackgroundJobData } from '../../background-jobs/background-jobs.queue';
import { DiscordRoleService } from '../services/discord-role.service';
import { DISCORD_MAINTENANCE_JOBS, DISCORD_MAINTENANCE_QUEUE } from './discord-maintenance.queue';

@Processor(DISCORD_MAINTENANCE_QUEUE, { concurrency: 1 })
export class DiscordMaintenanceProcessor extends WorkerHost {
  private readonly logger = new Logger(DiscordMaintenanceProcessor.name);

  constructor(private readonly roles: DiscordRoleService) {
    super();
  }

  async process(job: Job<BackgroundJobData>): Promise<void> {
    switch (job.name) {
      case DISCORD_MAINTENANCE_JOBS.SYNC_ROLES:
        await this.roles.syncAllLinkedMemberRoles('scheduled-discord-managed-role-sync');
        return;
      case DISCORD_MAINTENANCE_JOBS.ENFORCE_POLICY:
        await this.roles.syncAllGuildMemberRoleState('scheduled-discord-managed-role-hard-enforcement');
        return;
      default:
        throw new Error(`Unknown Discord maintenance job: ${job.name}`);
    }
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job<BackgroundJobData> | undefined, error: Error): void {
    this.logger.error('Discord maintenance job failed', { jobId: job?.id, jobName: job?.name, error });
  }
}
