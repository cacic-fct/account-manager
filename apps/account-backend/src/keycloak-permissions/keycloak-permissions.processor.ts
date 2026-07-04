import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import {
  KEYCLOAK_PERMISSION_JOBS,
  KEYCLOAK_PERMISSIONS_QUEUE,
  SyncPermissionGrantsJob,
} from './keycloak-permissions.queue';

@Processor(KEYCLOAK_PERMISSIONS_QUEUE)
export class KeycloakPermissionsProcessor extends WorkerHost {
  private readonly logger = new Logger(KeycloakPermissionsProcessor.name);

  constructor(private readonly keycloakPermissions: KeycloakPermissionsService) {
    super();
  }

  async process(job: Job<SyncPermissionGrantsJob>): Promise<void> {
    switch (job.name) {
      case KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS:
        await this.keycloakPermissions.synchronizeStudentEntityMemberships();
        await this.keycloakPermissions.synchronizePermissionGrants();
        return;
      default:
        this.logger.error(`Unknown Keycloak permission job: ${job.name}`);
        throw new Error(`Unknown Keycloak permission job: ${job.name}`);
    }
  }
}
