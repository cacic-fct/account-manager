import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DiscordBotModule } from '../discord/bot/discord-bot.module';
import { KeycloakPermissionsController, UserPermissionsController } from './keycloak-permissions.controller';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsGrantsService } from './keycloak-permissions-grants.service';
import { KeycloakPermissionsGroupRolesService } from './keycloak-permissions-group-roles.service';
import { KeycloakPermissionsMembershipsService } from './keycloak-permissions-memberships.service';
import { KeycloakPermissionsProcessor } from './keycloak-permissions.processor';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';
import { KEYCLOAK_PERMISSIONS_QUEUE } from './keycloak-permissions.queue';

@Module({
  imports: [AuthModule, DiscordBotModule, BullModule.registerQueue({ name: KEYCLOAK_PERMISSIONS_QUEUE })],
  controllers: [KeycloakPermissionsController, UserPermissionsController],
  providers: [
    KeycloakPermissionsCatalogService,
    KeycloakPermissionsGrantsService,
    KeycloakPermissionsGroupRolesService,
    KeycloakPermissionsMembershipsService,
    KeycloakPermissionsService,
    KeycloakPermissionsSyncService,
    KeycloakPermissionsProcessor,
  ],
  exports: [KeycloakPermissionsService],
})
export class KeycloakPermissionsModule {}
