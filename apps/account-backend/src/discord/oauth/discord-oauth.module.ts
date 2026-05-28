import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordOAuthController } from './discord-oauth.controller';
import { DiscordServicesModule } from '../services/discord-services.module';

@Module({
  imports: [DiscordServicesModule, ConfigModule],
  controllers: [DiscordOAuthController],
})
export class DiscordOAuthModule {}
