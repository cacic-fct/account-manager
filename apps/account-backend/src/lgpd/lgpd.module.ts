import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { LgpdController } from './lgpd.controller';
import { LgpdProcessor } from './lgpd.processor';
import { LgpdService } from './lgpd.service';
import { LGPD_QUEUE } from './lgpd.queue';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '../auth/jwt/jwt.module';
import { DiscordServicesModule } from '../discord/services/discord-services.module';

@Module({
  imports: [
    AuthModule,
    JwtModule,
    DiscordServicesModule,
    BullModule.registerQueue({ name: LGPD_QUEUE }),
  ],
  controllers: [LgpdController],
  providers: [LgpdService, LgpdProcessor],
  exports: [LgpdService],
})
export class LgpdModule {}
