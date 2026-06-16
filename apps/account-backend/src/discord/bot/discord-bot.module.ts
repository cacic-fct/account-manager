import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { DiscordBotService } from '../discord-bot.service';
import { DiscordEventsService } from '../discord-events.service';
import { DiscordClientService } from '../services/discord-client.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule, ConfigModule],
  providers: [
    DiscordBotService,
    DiscordEventsService,
    DiscordClientService,
    DiscordRoleService,
  ],
  exports: [DiscordBotService, DiscordClientService, DiscordRoleService],
})
export class DiscordBotModule {}
