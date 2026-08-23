import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LgpdService } from '../../lgpd/lgpd.service';

@Injectable()
export class CleanupSchedulerService {
  private readonly logger = new Logger(CleanupSchedulerService.name);

  constructor(private readonly lgpdService: LgpdService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupExpiredLgpdFiles(): Promise<void> {
    try {
      const recoveredSoftDeletions = await this.lgpdService.enqueuePendingSoftDeletions();
      if (recoveredSoftDeletions > 0) {
        this.logger.debug(`Recovered ${recoveredSoftDeletions} pending soft deletion job(s)`);
      }

      const reconciledCancellations = await this.lgpdService.reconcileCancelledAccountDeletions();
      if (reconciledCancellations > 0) {
        this.logger.debug(`Reconciled ${reconciledCancellations} cancelled account deletion(s)`);
      }

      const recoveredHardDeletions = await this.lgpdService.enqueueDueHardDeletions();
      if (recoveredHardDeletions > 0) {
        this.logger.debug(`Recovered ${recoveredHardDeletions} due hard deletion job(s)`);
      }

      const expiredRequests = await this.lgpdService.cleanupExpiredRequests();
      if (expiredRequests > 0) {
        this.logger.debug(`Expired ${expiredRequests} stale LGPD request(s)`);
      }

      const cleanedFiles = await this.lgpdService.cleanupExpiredFiles();
      if (cleanedFiles > 0) {
        this.logger.debug(`Cleaned up ${cleanedFiles} expired LGPD file(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to clean up expired LGPD files', error);
    }
  }
}
