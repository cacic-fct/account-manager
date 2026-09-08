import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';
import { RedisModule } from '../redis/redis.module';

@Module({
  imports: [ConfigModule, AuthModule, RedisModule],
  controllers: [TotpController],
  providers: [TotpService],
  exports: [TotpService],
})
export class TotpModule {}
