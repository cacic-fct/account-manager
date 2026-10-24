import { Queue } from 'bullmq';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsGrantsService } from './keycloak-permissions-grants.service';
import { KeycloakPermissionsGroupRolesService } from './keycloak-permissions-group-roles.service';
import { KeycloakPermissionsMembershipsService } from './keycloak-permissions-memberships.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import { KEYCLOAK_PERMISSION_JOBS, SyncPermissionGrantsJob } from './keycloak-permissions.queue';

describe('Permission scheduler migration', () => {
  it('removes only the old repeat definition and replaces it with a stable UTC scheduler', async () => {
    const queue = {
      setGlobalConcurrency: jest.fn().mockResolvedValue(1),
      removeRepeatable: jest.fn().mockResolvedValue(true),
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
    };
    const service = new KeycloakPermissionsService(
      {} as KeycloakPermissionsCatalogService,
      {} as KeycloakPermissionsGroupRolesService,
      {} as KeycloakPermissionsMembershipsService,
      {} as KeycloakPermissionsGrantsService,
      {} as KeycloakPermissionsSyncService,
      queue as unknown as Queue<SyncPermissionGrantsJob>,
    );

    await service.onApplicationBootstrap();

    expect(queue.removeRepeatable).toHaveBeenCalledWith(
      KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS,
      { pattern: '*/15 * * * *' },
      'keycloak-permission-grants-sync',
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'keycloak-permission-grants-sync',
      { pattern: '*/15 * * * *', tz: 'UTC' },
      expect.objectContaining({ name: KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS, data: { reason: 'scheduled' } }),
    );
    expect(queue.removeRepeatable.mock.invocationCallOrder[0]).toBeLessThan(
      queue.upsertJobScheduler.mock.invocationCallOrder[0],
    );
  });
});
