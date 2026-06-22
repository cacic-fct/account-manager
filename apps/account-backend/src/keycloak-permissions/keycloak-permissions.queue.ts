export const KEYCLOAK_PERMISSIONS_QUEUE = 'keycloak-permissions';

export const KEYCLOAK_PERMISSION_JOBS = {
  SYNC_GRANTS: 'sync-grants',
} as const;

export interface SyncPermissionGrantsJob {
  reason: 'scheduled' | 'manual';
}
