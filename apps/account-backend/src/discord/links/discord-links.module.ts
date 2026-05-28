import { Module } from '@nestjs/common';
import { DiscordLinksController } from './discord-links.controller';
import { DiscordServicesModule } from '../services/discord-services.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [AuthModule, DiscordServicesModule],
  controllers: [DiscordLinksController],
})
export class DiscordLinksModule {}
