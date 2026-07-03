import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordController } from './discord.controller';
import { DiscordRoleController } from './controllers/discord-role.controller';
import { DiscordOAuthModule } from './oauth/discord-oauth.module';
import { DiscordAdminModule } from './admin/discord-admin.module';
import { DiscordServicesModule } from './services/discord-services.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    ConfigModule,
    AuthModule,
    DiscordServicesModule,
    DiscordOAuthModule,
    DiscordAdminModule,
  ],
  controllers: [DiscordController, DiscordRoleController],
})
export class DiscordModule {}
