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
import { KeycloakPermissionsModule } from './keycloak-permissions/keycloak-permissions.module';
import { FeatureFlagsModule } from './feature-flags/feature-flags.module';
import { TotpModule } from './totp/totp.module';
import { M2MUsersModule } from './m2m-users/m2m-users.module';
import { ConfigModule } from '@nestjs/config';
import { NecordModule } from 'necord';
import { GatewayIntentBits } from 'discord.js';
import { PrismaModule } from './prisma/prisma.module';
import { BullModule } from '@nestjs/bullmq';
import { ScheduleModule } from '@nestjs/schedule';
import { GrpcModule } from './grpc/grpc.module';
import { OperationalMetricsController } from './common/controllers/operational-metrics.controller';
import { OperationalMetricsService } from './common/services/operational-metrics.service';
import { validateStartupConfig } from './config/startup-contract';

const discordBotToken = process.env.DISCORD_BOT_TOKEN?.trim();
const discordGuildId = process.env.DISCORD_GUILD_ID?.trim();
if (Boolean(discordBotToken) !== Boolean(discordGuildId)) {
  throw new Error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be configured together');
}
const discordEnabled = Boolean(discordBotToken && discordGuildId);
const redisPortValue = process.env.REDIS_PORT?.trim() || '6379';
if (!/^\d+$/.test(redisPortValue) || Number(redisPortValue) < 1 || Number(redisPortValue) > 65_535) {
  throw new Error('REDIS_PORT must be an integer between 1 and 65535');
}

@Module({
  imports: [
    CsrfModule,
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(redisPortValue),
        ...(process.env.REDIS_PASSWORD && {
          password: process.env.REDIS_PASSWORD,
        }),
      },
    }),
    ScheduleModule.forRoot(),
    AuthModule,
    KeycloakPermissionsModule,
    CommonModule,
    LgpdModule,
    PrivacyModule,
    RedisModule,
    StudentVerificationModule,
    UniversityValidationModule,
    ConfigModule.forRoot({ validate: validateStartupConfig }),
    GrpcModule,
    FeatureFlagsModule,
    TotpModule,
    M2MUsersModule,
    PrismaModule,
    ...(discordEnabled
      ? [
          DiscordModule,
          NecordModule.forRoot({
            token: discordBotToken!,
            intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages],
            development: [discordGuildId!],
          }),
        ]
      : []),
  ],
  controllers: [AppController, OperationalMetricsController],
  providers: [AppService, OperationalMetricsService],
})
export class AppModule {}
