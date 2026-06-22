import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { FeatureFlagService } from './feature-flags.service';

@Global()
@Module({
  imports: [ConfigModule],
  providers: [FeatureFlagService],
  exports: [FeatureFlagService],
})
export class FeatureFlagsModule {}
