import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from './jwt.service';
import { M2MGuard } from './m2m.guard';

@Module({
  imports: [ConfigModule],
  providers: [JwtService, M2MGuard],
  exports: [JwtService, M2MGuard],
})
export class JwtModule {}
