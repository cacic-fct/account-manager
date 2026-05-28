import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordOAuthService } from './discord-oauth.service';
import { DiscordLinkService } from './discord-link.service';
import { DiscordRoleService } from './discord-role.service';
import { DiscordRoleManagementService } from './discord-role-management.service';
import { DiscordClientService } from './discord-client.service';
import { DiscordMetadataService } from './discord-metadata.service';
import { DiscordSettingsService } from './discord-settings.service';
import { AuthModule } from '../../auth/auth.module';
import { DiscordBotModule } from '../bot/discord-bot.module';
import { CooldownService } from '../../common/services/cooldown.service';

@Module({
  imports: [ConfigModule, AuthModule, DiscordBotModule],
  providers: [
    DiscordOAuthService,
    DiscordLinkService,
    DiscordRoleService,
    DiscordRoleManagementService,
    DiscordClientService,
    DiscordMetadataService,
    DiscordSettingsService,
    CooldownService,
  ],
  exports: [
    DiscordOAuthService,
    DiscordLinkService,
    DiscordRoleService,
    DiscordRoleManagementService,
    DiscordClientService,
    DiscordMetadataService,
    DiscordSettingsService,
    CooldownService,
  ],
})
export class DiscordServicesModule {}
