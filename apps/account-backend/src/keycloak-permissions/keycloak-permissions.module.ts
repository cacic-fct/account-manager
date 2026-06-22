import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { KeycloakPermissionsController } from './keycloak-permissions.controller';
import { KeycloakPermissionsProcessor } from './keycloak-permissions.processor';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import { KEYCLOAK_PERMISSIONS_QUEUE } from './keycloak-permissions.queue';

@Module({
  imports: [
    AuthModule,
    BullModule.registerQueue({ name: KEYCLOAK_PERMISSIONS_QUEUE }),
  ],
  controllers: [KeycloakPermissionsController],
  providers: [KeycloakPermissionsService, KeycloakPermissionsProcessor],
  exports: [KeycloakPermissionsService],
})
export class KeycloakPermissionsModule {}
