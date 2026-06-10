import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { LgpdService } from './lgpd.service';
import {
  AccountDeletionJob,
  LGPD_JOBS,
  LGPD_QUEUE,
  ProcessDataRequestJob,
} from './lgpd.queue';

@Processor(LGPD_QUEUE)
export class LgpdProcessor extends WorkerHost {
  private readonly logger = new Logger(LgpdProcessor.name);

  constructor(private readonly lgpdService: LgpdService) {
    super();
  }

  async process(
    job: Job<ProcessDataRequestJob | AccountDeletionJob>,
  ): Promise<void> {
    switch (job.name) {
      case LGPD_JOBS.PROCESS_DATA_REQUEST:
        await this.lgpdService.processRequest(job.data.requestId);
        return;
      case LGPD_JOBS.SOFT_DELETE_ACCOUNT:
        await this.lgpdService.processAccountSoftDeletion(job.data.requestId);
        return;
      case LGPD_JOBS.HARD_DELETE_ACCOUNT:
        await this.lgpdService.processAccountHardDeletion(job.data.requestId);
        return;
      default:
        this.logger.error(`Unknown LGPD job: ${job.name}`);
        throw new Error(`Unknown LGPD job: ${job.name}`);
    }
  }
}
