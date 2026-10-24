import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordBotService } from '../discord-bot.service';
import { DiscordEventsService } from '../discord-events.service';
import { DiscordClientService } from '../services/discord-client.service';
import { DiscordManagedRoleOverridesService } from '../services/discord-managed-role-overrides.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { AuthModule } from '../../auth/auth.module';
import { BullModule } from '@nestjs/bullmq';
import { DISCORD_MAINTENANCE_QUEUE } from './discord-maintenance.queue';
import { DiscordMaintenanceProcessor } from './discord-maintenance.processor';
import { DiscordMaintenanceService } from './discord-maintenance.service';

const discordEnabled = Boolean(process.env.DISCORD_BOT_TOKEN?.trim() && process.env.DISCORD_GUILD_ID?.trim());

@Module({
  imports: [
    AuthModule,
    ConfigModule,
    ...(discordEnabled ? [BullModule.registerQueue({ name: DISCORD_MAINTENANCE_QUEUE })] : []),
  ],
  providers: [
    DiscordBotService,
    DiscordEventsService,
    DiscordClientService,
    DiscordManagedRoleOverridesService,
    DiscordRoleService,
    ...(discordEnabled ? [DiscordMaintenanceService, DiscordMaintenanceProcessor] : []),
  ],
  exports: [DiscordBotService, DiscordClientService, DiscordManagedRoleOverridesService, DiscordRoleService],
})
export class DiscordBotModule {}
