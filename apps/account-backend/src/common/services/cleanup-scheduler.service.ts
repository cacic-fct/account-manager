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
      const expiredRequests = await this.lgpdService.cleanupExpiredRequests();
      if (expiredRequests > 0) {
        this.logger.log(`Expired ${expiredRequests} stale LGPD request(s)`);
      }

      const cleanedFiles = await this.lgpdService.cleanupExpiredFiles();
      if (cleanedFiles > 0) {
        this.logger.log(`Cleaned up ${cleanedFiles} expired LGPD file(s)`);
      }
    } catch (error) {
      this.logger.error('Failed to clean up expired LGPD files', error);
    }
  }
}
