export const KEYCLOAK_PERMISSION_CLIENTS = [
  {
    clientId: 'cacic-account-manager',
    label: 'CACiC Account Manager',
  },
  {
    clientId: 'cacic-event-manager',
    label: 'CACiC Event Manager',
  },
  {
    clientId: 'cacic-voto',
    label: 'CACiC Voto',
  },
] as const;

export type KeycloakPermissionClientId =
  (typeof KEYCLOAK_PERMISSION_CLIENTS)[number]['clientId'];

export const HIDDEN_KEYCLOAK_ROLE_NAMES = ['uma_protection'] as const;
export const KEYCLOAK_BACKED_ROLE_NAMES = ['access', 'super-admin'] as const;

export const AccountManagerKeycloakRole = {
  Access: 'access',
  SuperAdmin: 'super-admin',
  DiscordManagementRead: 'discord-management#read',
  DiscordManagementUpdate: 'discord-management#update',
  StudentVerificationRead: 'student-verification#read',
  StudentVerificationReview: 'student-verification#review',
  StudentVerificationDownload: 'student-verification#download',
  AccountDeletionRead: 'account-deletion#read',
  AccountDeletionUpdate: 'account-deletion#update',
  PermissionGrantRead: 'permission-grant#read',
  PermissionGrantAssign: 'permission-grant#assign',
  PermissionGrantRevoke: 'permission-grant#revoke',
  PermissionGrantSync: 'permission-grant#sync',
} as const;

export type AccountManagerKeycloakRole =
  (typeof AccountManagerKeycloakRole)[keyof typeof AccountManagerKeycloakRole];

export const ACCOUNT_MANAGER_PERMISSION_CLIENT_ID =
  'cacic-account-manager' satisfies KeycloakPermissionClientId;

export const ACCOUNT_MANAGER_ADMIN_ROLE_CATALOG = [
  AccountManagerKeycloakRole.DiscordManagementRead,
  AccountManagerKeycloakRole.DiscordManagementUpdate,
  AccountManagerKeycloakRole.StudentVerificationRead,
  AccountManagerKeycloakRole.StudentVerificationReview,
  AccountManagerKeycloakRole.StudentVerificationDownload,
  AccountManagerKeycloakRole.AccountDeletionRead,
  AccountManagerKeycloakRole.AccountDeletionUpdate,
  AccountManagerKeycloakRole.PermissionGrantRead,
  AccountManagerKeycloakRole.PermissionGrantAssign,
  AccountManagerKeycloakRole.PermissionGrantRevoke,
  AccountManagerKeycloakRole.PermissionGrantSync,
] as const satisfies readonly AccountManagerKeycloakRole[];

export const ACCOUNT_MANAGER_ASSIGNABLE_ROLE_CATALOG = [
  AccountManagerKeycloakRole.Access,
  AccountManagerKeycloakRole.SuperAdmin,
  ...ACCOUNT_MANAGER_ADMIN_ROLE_CATALOG,
] as const satisfies readonly AccountManagerKeycloakRole[];

export function buildKeycloakPermissionId(
  clientId: string,
  roleName: string,
): string {
  return `${clientId.trim()}:${roleName.trim()}`;
}

export function buildAccountManagerPermissionId(
  roleName: AccountManagerKeycloakRole,
): string {
  return buildKeycloakPermissionId(
    ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
    roleName,
  );
}

export function parseKeycloakPermissionId(permission: string): {
  clientId: string;
  roleName: string;
} | null {
  const separatorIndex = permission.indexOf(':');
  if (separatorIndex <= 0 || separatorIndex === permission.length - 1) {
    return null;
  }

  const clientId = permission.slice(0, separatorIndex).trim();
  const roleName = permission.slice(separatorIndex + 1).trim();
  if (!clientId || !roleName) {
    return null;
  }

  return { clientId, roleName };
}

export function isKeycloakBackedRoleName(roleName: string): boolean {
  return KEYCLOAK_BACKED_ROLE_NAMES.includes(
    roleName as (typeof KEYCLOAK_BACKED_ROLE_NAMES)[number],
  );
}

export function isKeycloakBackedPermission(permission: string): boolean {
  const parsedPermission = parseKeycloakPermissionId(permission);
  return parsedPermission
    ? isKeycloakBackedRoleName(parsedPermission.roleName)
    : isKeycloakBackedRoleName(permission.trim());
}

export const AccountManagerPermission = {
  Access: buildAccountManagerPermissionId(AccountManagerKeycloakRole.Access),
  SuperAdmin: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.SuperAdmin,
  ),
  DiscordManagementRead: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.DiscordManagementRead,
  ),
  DiscordManagementUpdate: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.DiscordManagementUpdate,
  ),
  StudentVerificationRead: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.StudentVerificationRead,
  ),
  StudentVerificationReview: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.StudentVerificationReview,
  ),
  StudentVerificationDownload: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.StudentVerificationDownload,
  ),
  AccountDeletionRead: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.AccountDeletionRead,
  ),
  AccountDeletionUpdate: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.AccountDeletionUpdate,
  ),
  PermissionGrantRead: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.PermissionGrantRead,
  ),
  PermissionGrantAssign: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.PermissionGrantAssign,
  ),
  PermissionGrantRevoke: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.PermissionGrantRevoke,
  ),
  PermissionGrantSync: buildAccountManagerPermissionId(
    AccountManagerKeycloakRole.PermissionGrantSync,
  ),
} as const;

export type AccountManagerPermission =
  (typeof AccountManagerPermission)[keyof typeof AccountManagerPermission];

export const ACCOUNT_MANAGER_ADMIN_PERMISSIONS = [
  AccountManagerPermission.DiscordManagementRead,
  AccountManagerPermission.DiscordManagementUpdate,
  AccountManagerPermission.StudentVerificationRead,
  AccountManagerPermission.StudentVerificationReview,
  AccountManagerPermission.StudentVerificationDownload,
  AccountManagerPermission.AccountDeletionRead,
  AccountManagerPermission.AccountDeletionUpdate,
  AccountManagerPermission.PermissionGrantRead,
  AccountManagerPermission.PermissionGrantAssign,
  AccountManagerPermission.PermissionGrantRevoke,
  AccountManagerPermission.PermissionGrantSync,
] as const satisfies readonly AccountManagerPermission[];

export const PermissionGroupKey = {
  Cacic: 'CACIC',
  Ejcomp: 'EJCOMP',
  ElectionsCacic: 'ELECTIONS_CACIC',
  Secompp: 'SECOMPP',
  SecomppSystems: 'SECOMPP_SYSTEMS',
} as const;

export type PermissionGroupKey =
  (typeof PermissionGroupKey)[keyof typeof PermissionGroupKey];

export interface PermissionGroupDefinition {
  key: PermissionGroupKey;
  label: string;
  description: string;
  rootLabel: string;
  keycloakGroupId: string;
  keycloakGroupIdPath: string;
  keycloakGroupPath: string;
  discordRoleId?: string;
  managedBy?: PermissionGroupKey;
}

export const PERMISSION_GROUP_CATALOG = [
  {
    key: PermissionGroupKey.Cacic,
    label: 'CACiC',
    description: 'Centro Academico da Ciencia da Computacao.',
    rootLabel: 'Entidades estudantis',
    keycloakGroupId: '5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
    keycloakGroupIdPath:
      '27337291-8ad5-40a7-9267-d70cfa60a2de/5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
    keycloakGroupPath: '/Entidades estudantis/CACiC',
    discordRoleId: '533900085642133504',
    managedBy: PermissionGroupKey.Cacic,
  },
  {
    key: PermissionGroupKey.Ejcomp,
    label: 'EJComp',
    description: 'Empresa Junior de Computacao.',
    rootLabel: 'Entidades estudantis',
    keycloakGroupId: '5a3de54b-21f1-4db1-9513-a450f325e151',
    keycloakGroupIdPath:
      '27337291-8ad5-40a7-9267-d70cfa60a2de/5a3de54b-21f1-4db1-9513-a450f325e151',
    keycloakGroupPath: '/Entidades estudantis/EJComp',
    discordRoleId: '1400636044050960425',
    managedBy: PermissionGroupKey.Cacic,
  },
  {
    key: PermissionGroupKey.ElectionsCacic,
    label: 'Eleições CACiC',
    description: 'Comissao eleitoral do CACiC.',
    rootLabel: 'Comissões',
    keycloakGroupId: 'dfd321d2-ef57-4851-9bc4-6e6c09192a7c',
    keycloakGroupIdPath:
      '0f0463d1-f0a9-4412-ae21-2ab8c812891e/dfd321d2-ef57-4851-9bc4-6e6c09192a7c',
    keycloakGroupPath: '/Comissões/Eleições CACiC',
    managedBy: PermissionGroupKey.Cacic,
  },
  {
    key: PermissionGroupKey.Secompp,
    label: 'SECOMPP',
    description: 'Comissao organizadora da SECOMPP.',
    rootLabel: 'Comissões',
    keycloakGroupId: 'f71d95d0-256d-44fc-91ed-0e7c64f1ce1f',
    keycloakGroupIdPath:
      '0f0463d1-f0a9-4412-ae21-2ab8c812891e/f71d95d0-256d-44fc-91ed-0e7c64f1ce1f',
    keycloakGroupPath: '/Comissões/SECOMPP',
    discordRoleId: '1520835558849642617',
    managedBy: PermissionGroupKey.Cacic,
  },
  {
    key: PermissionGroupKey.SecomppSystems,
    label: 'Sistemas SECOMPP',
    description: 'Equipe de sistemas da SECOMPP.',
    rootLabel: 'Comissões',
    keycloakGroupId: '377c4c10-f5d6-4d7e-a5b2-07975f3299b5',
    keycloakGroupIdPath:
      '0f0463d1-f0a9-4412-ae21-2ab8c812891e/f71d95d0-256d-44fc-91ed-0e7c64f1ce1f/377c4c10-f5d6-4d7e-a5b2-07975f3299b5',
    keycloakGroupPath: '/Comissões/SECOMPP/Sistemas SECOMPP',
    discordRoleId: '1263175649263226900',
    managedBy: PermissionGroupKey.Secompp,
  },
] as const satisfies readonly PermissionGroupDefinition[];

export const PERMISSION_GROUP_SET = new Set<PermissionGroupKey>(
  PERMISSION_GROUP_CATALOG.map((definition) => definition.key),
);

export const PERMISSION_GROUP_DISCORD_ROLE_IDS = (
  PERMISSION_GROUP_CATALOG as readonly PermissionGroupDefinition[]
)
  .map((definition) => definition.discordRoleId)
  .filter((roleId): roleId is string => !!roleId);

export function isPermissionGroupKey(
  value: string,
): value is PermissionGroupKey {
  return PERMISSION_GROUP_SET.has(value as PermissionGroupKey);
}

export type KeycloakPermissionGrantStatus = 'active' | 'scheduled' | 'expired';

export type KeycloakPermissionGrantSource = 'direct' | 'group';

export interface KeycloakPermissionDefinition {
  permission: string;
  clientId: string;
  clientLabel: string;
  roleName: string;
  label: string;
  description?: string;
  composite?: boolean;
  source?: 'keycloak' | 'fallback';
}

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
  clientId: string;
  roleName: string;
  permission: string;
  source: KeycloakPermissionGrantSource;
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
  permission: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface KeycloakPermissionGrantUpdateRequest {
  permission?: string;
  validFrom?: string | null;
  validUntil?: string | null;
}

export interface PermissionGroupRoleGrant {
  id: string;
  groupKey: PermissionGroupKey;
  clientId: string;
  roleName: string;
  permission: string;
  source: 'database' | 'keycloak';
  validFrom: string | null;
  validUntil: string | null;
  status: KeycloakPermissionGrantStatus;
  createdAt?: string;
  createdById?: string;
  updatedAt?: string;
  updatedById?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export interface PermissionGroupRoleGrantUpdateRequest {
  permissions: string[];
}

export type PermissionGroupMembershipStatus =
  | 'active'
  | 'scheduled'
  | 'expired';

export interface PermissionGroupMembership {
  id: string;
  groupKey: PermissionGroupKey;
  keycloakGroupId: string;
  keycloakGroupPath: string;
  discordRoleId?: string;
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  validFrom: string;
  validUntil: string | null;
  status: PermissionGroupMembershipStatus;
  createdAt: string;
  createdById?: string;
  updatedAt: string;
  updatedById?: string;
  lastSyncedAt?: string;
  lastSyncError?: string;
}

export interface PermissionGroupMembershipCreateRequest {
  userId: string;
  groupKey: PermissionGroupKey;
  validFrom: string;
  validUntil?: string | null;
}

export interface PermissionGroupMembershipUpdateRequest {
  validFrom: string;
  validUntil?: string | null;
}

export interface KeycloakPermissionSyncResult {
  activated: number;
  expired: number;
  failed: number;
}

export interface PermissionSelfServiceAccess {
  memberships: PermissionGroupMembership[];
  grants: KeycloakPermissionGrant[];
}

export interface PermissionSelfRemovalResult {
  removed: true;
  id: string;
}

export type AssignableKeycloakPermission = string;
export type StudentEntityKey = PermissionGroupKey;
export type StudentEntityDefinition = PermissionGroupDefinition;
export type StudentEntityMembership = PermissionGroupMembership;
export type StudentEntityMembershipCreateRequest =
  PermissionGroupMembershipCreateRequest;
export type StudentEntityMembershipUpdateRequest =
  PermissionGroupMembershipUpdateRequest;
export type StudentEntityMembershipStatus = PermissionGroupMembershipStatus;

export const STUDENT_ENTITY_CATALOG = PERMISSION_GROUP_CATALOG;
export const STUDENT_ENTITY_SET = PERMISSION_GROUP_SET;

export function isStudentEntityKey(value: string): value is StudentEntityKey {
  return isPermissionGroupKey(value);
}
