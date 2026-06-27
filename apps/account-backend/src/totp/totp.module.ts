import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '../auth/jwt/jwt.module';
import { TotpApiController } from './totp-api.controller';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';

@Module({
  imports: [ConfigModule, AuthModule, JwtModule],
  controllers: [TotpController, TotpApiController],
  providers: [TotpService],
  exports: [TotpService],
})
export class TotpModule {}
