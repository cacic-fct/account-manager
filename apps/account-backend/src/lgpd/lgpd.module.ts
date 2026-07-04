import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LgpdController } from './lgpd.controller';
import { LgpdProcessor } from './lgpd.processor';
import { LgpdService } from './lgpd.service';
import { LGPD_QUEUE } from './lgpd.queue';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '../auth/jwt/jwt.module';
import { DiscordServicesModule } from '../discord/services/discord-services.module';
import { AdminCleanupController } from '../common/controllers/admin-cleanup.controller';
import { CleanupSchedulerService } from '../common/services/cleanup-scheduler.service';

@Module({
  imports: [AuthModule, JwtModule, DiscordServicesModule, BullModule.registerQueue({ name: LGPD_QUEUE })],
  controllers: [LgpdController, AdminCleanupController],
  providers: [LgpdService, LgpdProcessor, CleanupSchedulerService],
  exports: [LgpdService],
})
export class LgpdModule {}
