import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordOAuthController } from './discord-oauth.controller';
import { DiscordServicesModule } from '../services/discord-services.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [DiscordServicesModule, ConfigModule, AuthModule],
  controllers: [DiscordOAuthController],
})
export class DiscordOAuthModule {}
