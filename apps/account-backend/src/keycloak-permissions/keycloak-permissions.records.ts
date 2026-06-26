import {
  KEYCLOAK_PERMISSION_CATALOG,
  type AssignableKeycloakPermission,
} from '@cacic/shared-types';
import { Prisma } from '@prisma/client';

export const SYNC_ACTOR_ID = 'system:keycloak-permissions-sync';

export const ASSIGNABLE_KEYCLOAK_PERMISSIONS = KEYCLOAK_PERMISSION_CATALOG.map(
  (definition) => definition.permission,
) satisfies AssignableKeycloakPermission[];

export const GRANT_SELECT = {
  id: true,
  userId: true,
  userEmail: true,
  userDisplayName: true,
  studentEntityMembershipId: true,
  permission: true,
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
      permission: {
        in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
      },
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
  mandateEnd: Date;
};
