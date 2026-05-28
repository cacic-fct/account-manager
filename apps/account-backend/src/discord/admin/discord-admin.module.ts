import { Module } from '@nestjs/common';
import { DiscordAdminController } from './discord-admin.controller';
import { DiscordServicesModule } from '../services/discord-services.module';
import { AuthModule } from '../../auth/auth.module';

@Module({
  imports: [DiscordServicesModule, AuthModule],
  controllers: [DiscordAdminController],
})
export class DiscordAdminModule {}
