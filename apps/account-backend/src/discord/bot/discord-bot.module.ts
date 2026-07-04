import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordBotService } from '../discord-bot.service';
import { DiscordEventsService } from '../discord-events.service';
import { DiscordClientService } from '../services/discord-client.service';
import { DiscordManagedRoleOverridesService } from '../services/discord-managed-role-overrides.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [
    DiscordBotService,
    DiscordEventsService,
    DiscordClientService,
    DiscordManagedRoleOverridesService,
    DiscordRoleService,
  ],
  exports: [
    DiscordBotService,
    DiscordClientService,
    DiscordManagedRoleOverridesService,
    DiscordRoleService,
  ],
})
export class DiscordBotModule {}
