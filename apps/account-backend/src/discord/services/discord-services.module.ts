import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordOAuthService } from './discord-oauth.service';
import { DiscordLinkService } from './discord-link.service';
import { DiscordRoleManagementService } from './discord-role-management.service';
import { DiscordSettingsService } from './discord-settings.service';
import { AuthModule } from '../../auth/auth.module';
import { DiscordBotModule } from '../bot/discord-bot.module';
import { CooldownService } from '../../common/services/cooldown.service';

@Module({
  imports: [ConfigModule, AuthModule, DiscordBotModule],
  providers: [
    DiscordOAuthService,
    DiscordLinkService,
    DiscordRoleManagementService,
    DiscordSettingsService,
    CooldownService,
  ],
  exports: [
    DiscordOAuthService,
    DiscordLinkService,
    DiscordRoleManagementService,
    DiscordSettingsService,
    CooldownService,
    DiscordBotModule,
  ],
})
export class DiscordServicesModule {}
