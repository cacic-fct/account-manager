import {
  ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
  KEYCLOAK_PERMISSION_CLIENTS,
  KEYCLOAK_BACKED_ROLE_NAMES,
} from '@cacic/shared-types';
import { Prisma } from '@prisma/client';

export const SYNC_ACTOR_ID = 'system:keycloak-permissions-sync';

export const MANAGED_KEYCLOAK_CLIENT_IDS = KEYCLOAK_PERMISSION_CLIENTS.map(
  (definition) => definition.clientId,
);

export const ACCOUNT_MANAGER_ADMIN_PERMISSION_IDS = [
  ...ACCOUNT_MANAGER_ADMIN_PERMISSIONS,
];

export const DB_MANAGED_ROLE_FILTER = {
  notIn: [...KEYCLOAK_BACKED_ROLE_NAMES],
};

export const GRANT_SELECT = {
  id: true,
  userId: true,
  userEmail: true,
  userDisplayName: true,
  studentEntityMembershipId: true,
  permission: true,
  clientId: true,
  roleName: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  updatedById: true,
  deletedAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
} satisfies Prisma.KeycloakPermissionGrantSelect;

export type GrantRecord = Prisma.KeycloakPermissionGrantGetPayload<{
  select: typeof GRANT_SELECT;
}>;

export const GROUP_ROLE_GRANT_SELECT = {
  id: true,
  groupKey: true,
  keycloakGroupId: true,
  permission: true,
  clientId: true,
  roleName: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  updatedById: true,
  deletedAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
} satisfies Prisma.KeycloakGroupPermissionGrantSelect;

export type GroupRoleGrantRecord =
  Prisma.KeycloakGroupPermissionGrantGetPayload<{
    select: typeof GROUP_ROLE_GRANT_SELECT;
  }>;

export const MEMBERSHIP_SELECT = {
  id: true,
  entity: true,
  keycloakGroupPath: true,
  userId: true,
  userEmail: true,
  userDisplayName: true,
  mandateStart: true,
  mandateEnd: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  updatedById: true,
  deletedAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
  permissionGrants: {
    where: {
      deletedAt: null,
      roleName: DB_MANAGED_ROLE_FILTER,
    },
    select: GRANT_SELECT,
    orderBy: [{ permission: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.StudentEntityMembershipSelect;

export type MembershipRecord = Prisma.StudentEntityMembershipGetPayload<{
  select: typeof MEMBERSHIP_SELECT;
}>;

export type NormalizedValidityWindow = {
  validFrom: Date | null;
  validUntil: Date | null;
};

export type NormalizedMandateWindow = {
  mandateStart: Date;
  mandateEnd: Date | null;
};
