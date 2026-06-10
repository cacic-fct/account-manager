import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { CommonModule } from './common/common.module';
import { LgpdModule } from './lgpd/lgpd.module';
import { PrivacyModule } from './privacy/privacy.module';
import { DiscordModule } from './discord/discord.module';
import { RedisModule } from './redis/redis.module';
import { StudentVerificationModule } from './student-verification/student-verification.module';
import { UniversityValidationModule } from './university-validation/university-validation.module';
import { CsrfModule } from './auth/csrf/csrf.module';
import { ConfigModule } from '@nestjs/config';
import { NecordModule } from 'necord';
import { GatewayIntentBits } from 'discord.js';
import { PrismaModule } from './prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';

const getRequiredEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} environment variable is required`);
  }

  return value;
};

const discordBotToken = getRequiredEnv('DISCORD_BOT_TOKEN');
const discordGuildId = getRequiredEnv('DISCORD_GUILD_ID');

@Module({
  imports: [
    CsrfModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT || 6379),
        ...(process.env.REDIS_PASSWORD && {
          password: process.env.REDIS_PASSWORD,
        }),
      },
    }),
    AuthModule,
    CommonModule,
    LgpdModule,
    PrivacyModule,
    DiscordModule,
    RedisModule,
    StudentVerificationModule,
    UniversityValidationModule,
    ConfigModule.forRoot(),
    PrismaModule,
    NecordModule.forRoot({
      token: discordBotToken,
      intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessages,
      ],
      development: [discordGuildId],
    }),
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
