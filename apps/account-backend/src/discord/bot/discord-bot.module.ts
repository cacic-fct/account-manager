import { Module } from '@nestjs/common';
import { DiscordBotService } from '../discord-bot.service';
import { DiscordEventsService } from '../discord-events.service';
import { DiscordClientService } from '../services/discord-client.service';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule],
  providers: [DiscordBotService, DiscordEventsService, DiscordClientService],
  exports: [DiscordBotService, DiscordEventsService, DiscordClientService],
})
export class DiscordBotModule {}
