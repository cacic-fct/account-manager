export const AccountManagerKeycloakRole = {
  Access: 'account-manager#access',
  SuperAdmin: 'account-manager#super-admin',
} as const;

export type AccountManagerKeycloakRole =
  (typeof AccountManagerKeycloakRole)[keyof typeof AccountManagerKeycloakRole];

export const EventManagerKeycloakRole = {
  Access: 'event-manager#access',
  SuperAdmin: 'event-manager#super-admin',
} as const;

export type EventManagerKeycloakRole =
  (typeof EventManagerKeycloakRole)[keyof typeof EventManagerKeycloakRole];

export const DiscordKeycloakRole = {
  Admin: 'discord#admin',
} as const;

export type DiscordKeycloakRole =
  (typeof DiscordKeycloakRole)[keyof typeof DiscordKeycloakRole];

export const AssignableKeycloakPermission = {
  AccountManagerAccess: AccountManagerKeycloakRole.Access,
  AccountManagerSuperAdmin: AccountManagerKeycloakRole.SuperAdmin,
  EventManagerAccess: EventManagerKeycloakRole.Access,
  EventManagerSuperAdmin: EventManagerKeycloakRole.SuperAdmin,
  DiscordAdmin: DiscordKeycloakRole.Admin,
} as const;

export type AssignableKeycloakPermission =
  (typeof AssignableKeycloakPermission)[keyof typeof AssignableKeycloakPermission];

export type KeycloakPermissionApplication =
  | 'account-manager'
  | 'event-manager'
  | 'discord';

export interface KeycloakPermissionDefinition {
  permission: AssignableKeycloakPermission;
  application: KeycloakPermissionApplication;
  label: string;
  description: string;
}

export const KEYCLOAK_PERMISSION_CATALOG = [
  {
    permission: AssignableKeycloakPermission.AccountManagerAccess,
    application: 'account-manager',
    label: 'Account Manager access',
    description: 'Allows the user to access CACiC Account Manager.',
  },
  {
    permission: AssignableKeycloakPermission.AccountManagerSuperAdmin,
    application: 'account-manager',
    label: 'Account Manager super admin',
    description:
      'Allows the user to manage Account Manager administration and permission grants.',
  },
  {
    permission: AssignableKeycloakPermission.EventManagerAccess,
    application: 'event-manager',
    label: 'Event Manager access',
    description: 'Allows the user to access CACiC Event Manager.',
  },
  {
    permission: AssignableKeycloakPermission.EventManagerSuperAdmin,
    application: 'event-manager',
    label: 'Event Manager super admin',
    description:
      'Allows the user to bypass Event Manager app-owned authorization checks.',
  },
  {
    permission: AssignableKeycloakPermission.DiscordAdmin,
    application: 'discord',
    label: 'Discord admin',
    description:
      'Allows the user to manage Discord integration settings and role selection.',
  },
] as const satisfies readonly KeycloakPermissionDefinition[];

export const KEYCLOAK_PERMISSION_SET = new Set<AssignableKeycloakPermission>(
  KEYCLOAK_PERMISSION_CATALOG.map((definition) => definition.permission),
);

export function isAssignableKeycloakPermission(
  permission: string,
): permission is AssignableKeycloakPermission {
  return KEYCLOAK_PERMISSION_SET.has(
    permission as AssignableKeycloakPermission,
  );
}

export type KeycloakPermissionGrantStatus =
  | 'active'
  | 'scheduled'
  | 'expired';

export interface KeycloakPermissionUser {
  id: string;
  email: string;
  username?: string;
  fullName?: string;
  displayName: string;
  identityDocument?: string;
  enabled?: boolean;
}

export interface KeycloakPermissionGrant {
  id: string;
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  studentEntityMembershipId?: string;
  permission: AssignableKeycloakPermission;
  validFrom: string | null;
  validUntil: string | null;
  status: KeycloakPermissionGrantStatus;
  createdAt: string;
  createdById?: string;
  updatedAt: string;
  updatedById?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export interface KeycloakPermissionGrantCreateRequest {
  userId: string;
  permission: AssignableKeycloakPermission;
  studentEntityMembershipId?: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface KeycloakPermissionGrantUpdateRequest {
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface KeycloakPermissionSyncResult {
  activated: number;
  expired: number;
  failed: number;
}

export const StudentEntityKey = {
  Cacic: 'CACIC',
  Ejcomp: 'EJCOMP',
} as const;

export type StudentEntityKey =
  (typeof StudentEntityKey)[keyof typeof StudentEntityKey];

export interface StudentEntityDefinition {
  key: StudentEntityKey;
  label: string;
  description: string;
  keycloakGroupPath: string;
  managedBy: StudentEntityKey;
}

export const STUDENT_ENTITY_CATALOG = [
  {
    key: StudentEntityKey.Cacic,
    label: 'CACiC',
    description: 'Centro Academico da Ciencia da Computacao',
    keycloakGroupPath: '/student-entities/cacic',
    managedBy: StudentEntityKey.Cacic,
  },
  {
    key: StudentEntityKey.Ejcomp,
    label: 'EJComp',
    description: 'Empresa Junior de Computacao',
    keycloakGroupPath: '/student-entities/ejcomp',
    managedBy: StudentEntityKey.Cacic,
  },
] as const satisfies readonly StudentEntityDefinition[];

export const STUDENT_ENTITY_SET = new Set<StudentEntityKey>(
  STUDENT_ENTITY_CATALOG.map((definition) => definition.key),
);

export function isStudentEntityKey(value: string): value is StudentEntityKey {
  return STUDENT_ENTITY_SET.has(value as StudentEntityKey);
}

export type StudentEntityMembershipStatus =
  | 'active'
  | 'scheduled'
  | 'expired';

export interface StudentEntityMembership {
  id: string;
  entity: StudentEntityKey;
  keycloakGroupPath: string;
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  mandateStart: string;
  mandateEnd: string;
  status: StudentEntityMembershipStatus;
  permissionGrants: KeycloakPermissionGrant[];
  createdAt: string;
  createdById?: string;
  updatedAt: string;
  updatedById?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export interface StudentEntityMembershipCreateRequest {
  userId: string;
  entity: StudentEntityKey;
  mandateStart: string;
  mandateEnd: string;
  permissions: AssignableKeycloakPermission[];
}

export interface StudentEntityMembershipUpdateRequest {
  mandateStart: string;
  mandateEnd: string;
  permissions: AssignableKeycloakPermission[];
}

export interface StudentEntitySyncResult {
  activated: number;
  expired: number;
  failed: number;
}
