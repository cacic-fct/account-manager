import { fakerPT_BR as faker } from '@faker-js/faker';
import {
  ACCOUNT_MANAGER_ADMIN_ROLE_CATALOG,
  ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
  AccountManagerPermission,
  KEYCLOAK_PERMISSION_CLIENTS,
  PERMISSION_GROUP_CATALOG,
  PermissionGroupKey,
  UnespRole,
  buildKeycloakPermissionId,
  parseKeycloakPermissionId,
  type Application,
  type KeycloakPermissionDefinition,
  type KeycloakPermissionGrant,
  type KeycloakPermissionUser,
  type PermissionGroupDefinition,
  type PermissionGroupMembership,
  type PermissionGroupRoleGrant,
  type User,
} from '@cacic/shared-types';
import type {
  DiscordLinkStatus,
  DiscordRole,
  SelectableRoles,
  UserRoles,
  ServerSetting,
} from '../../app/shared/services/api.service';
import type { VerificationStatus } from '../../app/shared/services/student-verification/student-verification.service';

faker.seed(20260621);

const mockNow = new Date('2026-06-21T12:00:00.000Z');

const addDays = (date: Date, days: number): Date => {
  const nextDate = new Date(date);
  nextDate.setDate(nextDate.getDate() + days);
  return nextDate;
};

const accountManagerRoleLabels: Record<string, string> = {
  access: 'Acesso',
  'super-admin': 'Super-admin',
  'discord-management#read': 'Ler Discord',
  'discord-management#update': 'Gerenciar Discord',
  'student-verification#read': 'Ler validações estudantis',
  'student-verification#review': 'Revisar validações estudantis',
  'student-verification#download': 'Baixar documentos de validação',
  'account-deletion#read': 'Ler fila de exclusão',
  'account-deletion#update': 'Gerenciar fila de exclusão',
  'permission-grant#read': 'Ler permissões',
  'permission-grant#assign': 'Atribuir permissões',
  'permission-grant#revoke': 'Revogar permissões',
  'permission-grant#sync': 'Sincronizar permissões',
};

const createPermissionUser = (index: number): KeycloakPermissionUser => {
  const firstName = faker.person.firstName();
  const lastName = faker.person.lastName();
  const fullName = `${firstName} ${lastName}`;
  const username = faker.internet
    .username({ firstName, lastName })
    .toLowerCase();

  return {
    id: `keycloak-user-${index + 1}`,
    email: faker.internet.email({ firstName, lastName }).toLowerCase(),
    username,
    fullName,
    displayName: fullName,
    identityDocument: faker.string.numeric(11),
    enabled: true,
  };
};

const getClientLabel = (clientId: string): string =>
  KEYCLOAK_PERMISSION_CLIENTS.find(
    (definition) => definition.clientId === clientId,
  )?.label ?? clientId;

const createPermissionDefinition = (
  clientId: string,
  roleName: string,
  label?: string,
): KeycloakPermissionDefinition => ({
  permission: buildKeycloakPermissionId(clientId, roleName),
  clientId,
  clientLabel: getClientLabel(clientId),
  roleName,
  label: label ?? accountManagerRoleLabels[roleName] ?? roleName,
  source: 'keycloak',
});

export const mockKeycloakPermissionCatalog: KeycloakPermissionDefinition[] = [
  ...ACCOUNT_MANAGER_ADMIN_ROLE_CATALOG.map((roleName) =>
    createPermissionDefinition(ACCOUNT_MANAGER_PERMISSION_CLIENT_ID, roleName),
  ),
  createPermissionDefinition('cacic-event-manager', 'events#read', 'Ler eventos'),
  createPermissionDefinition(
    'cacic-event-manager',
    'events#publish',
    'Publicar eventos',
  ),
  createPermissionDefinition('cacic-voto', 'elections#read', 'Ler eleições'),
  createPermissionDefinition(
    'cacic-voto',
    'elections#manage',
    'Gerenciar eleições',
  ),
];

export const mockPermissionGroupCatalog: PermissionGroupDefinition[] = [
  ...PERMISSION_GROUP_CATALOG,
];

export const mockStudentEntityCatalog = mockPermissionGroupCatalog;

export const mockKeycloakPermissionUsers = Array.from({ length: 8 }, (_, index) =>
  createPermissionUser(index),
);

export const createMockKeycloakPermissionGrant = (
  user: KeycloakPermissionUser,
  permission: string,
  index: number,
  options: {
    source?: 'direct' | 'group';
    validFrom?: Date | null;
    validUntil?: Date | null;
  } = {},
): KeycloakPermissionGrant => {
  const parsedPermission =
    parseKeycloakPermissionId(permission) ??
    parseKeycloakPermissionId(AccountManagerPermission.Access);

  return {
    id: `grant-${user.id}-${index + 1}`,
    userId: user.id,
    userEmail: user.email,
    userDisplayName: user.displayName,
    clientId: parsedPermission?.clientId ?? ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
    roleName: parsedPermission?.roleName ?? 'access',
    permission,
    source: options.source ?? 'direct',
    validFrom: options.validFrom?.toISOString() ?? null,
    validUntil: options.validUntil?.toISOString() ?? null,
    status:
      options.validFrom && options.validFrom > mockNow ? 'scheduled' : 'active',
    createdAt: addDays(mockNow, -21).toISOString(),
    createdById: 'storybook-admin',
    updatedAt: addDays(mockNow, -2).toISOString(),
    updatedById: 'storybook-admin',
    lastSyncedAt: addDays(mockNow, -1).toISOString(),
  };
};

export const createMockStudentEntityMembership = (
  user: KeycloakPermissionUser,
  groupKey: PermissionGroupKey,
  index: number,
): PermissionGroupMembership => {
  const definition =
    mockPermissionGroupCatalog.find((candidate) => candidate.key === groupKey) ??
    mockPermissionGroupCatalog[0];
  const membershipId = `membership-${groupKey.toLowerCase()}-${index + 1}`;
  const validFrom = addDays(mockNow, -45 - index * 7);
  const validUntil = addDays(mockNow, 285 - index * 11);

  return {
    id: membershipId,
    groupKey,
    keycloakGroupId: definition.keycloakGroupId,
    keycloakGroupPath: definition.keycloakGroupPath,
    discordRoleId: definition.discordRoleId,
    userId: user.id,
    userEmail: user.email,
    userDisplayName: user.displayName,
    validFrom: validFrom.toISOString(),
    validUntil: validUntil.toISOString(),
    status: 'active',
    createdAt: addDays(mockNow, -50).toISOString(),
    createdById: 'storybook-admin',
    updatedAt: addDays(mockNow, -3).toISOString(),
    updatedById: 'storybook-admin',
    lastSyncedAt: addDays(mockNow, -1).toISOString(),
  };
};

export const mockStudentEntityMemberships: PermissionGroupMembership[] = [
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[0],
    PermissionGroupKey.Cacic,
    0,
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[1],
    PermissionGroupKey.Cacic,
    1,
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[2],
    PermissionGroupKey.Cacic,
    2,
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[3],
    PermissionGroupKey.Ejcomp,
    3,
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[4],
    PermissionGroupKey.Secompp,
    4,
  ),
];

const createMockPermissionGroupRoleGrant = (
  groupKey: PermissionGroupKey,
  permission: string,
  index: number,
  source: 'database' | 'keycloak' = 'database',
): PermissionGroupRoleGrant => {
  const parsedPermission =
    parseKeycloakPermissionId(permission) ??
    parseKeycloakPermissionId(AccountManagerPermission.Access);

  return {
    id: `group-grant-${groupKey.toLowerCase()}-${index + 1}`,
    groupKey,
    clientId: parsedPermission?.clientId ?? ACCOUNT_MANAGER_PERMISSION_CLIENT_ID,
    roleName: parsedPermission?.roleName ?? 'access',
    permission,
    source,
    validFrom: null,
    validUntil: null,
    status: 'active',
    createdAt: addDays(mockNow, -20).toISOString(),
    createdById: 'storybook-admin',
    updatedAt: addDays(mockNow, -2).toISOString(),
    updatedById: 'storybook-admin',
    lastSyncedAt: addDays(mockNow, -1).toISOString(),
  };
};

export const mockPermissionGroupRoleGrants: PermissionGroupRoleGrant[] = [
  createMockPermissionGroupRoleGrant(
    PermissionGroupKey.Cacic,
    AccountManagerPermission.PermissionGrantRead,
    0,
  ),
  createMockPermissionGroupRoleGrant(
    PermissionGroupKey.Cacic,
    AccountManagerPermission.StudentVerificationReview,
    1,
    'keycloak',
  ),
  createMockPermissionGroupRoleGrant(
    PermissionGroupKey.Secompp,
    buildKeycloakPermissionId('cacic-event-manager', 'events#publish'),
    2,
  ),
];

export const mockDirectKeycloakPermissionGrant =
  createMockKeycloakPermissionGrant(
    mockKeycloakPermissionUsers[0],
    AccountManagerPermission.SuperAdmin,
    8,
  );

export const mockUser: User = {
  id: 'usr_1',
  username: 'joao.silva',
  email: 'joao.silva@unesp.br',
  fullname: 'João Silva',
  displayName: 'João Silva',
  picture: 'https://github.com/octocat.png',
  phone: '+5511999999999',
  enrollmentNumber: '2024123456',
  identityDocument: '123.456.789-09',
  isForeigner: false,
  isOnboarded: true,
  unespRole: UnespRole.ALUNO_GRADUACAO,
  unespRoleVerified: true,
  isAdmin: false,
  adminGroups: [],
  createdAt: new Date('2025-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
};

export const mockApplication: Application = {
  id: 'app_1',
  name: 'Portal do Aluno',
  description: 'Acesso rápido aos principais serviços acadêmicos.',
  url: 'https://example.org/portal',
  iconUrl: 'https://example.org/icon.svg',
  category: 'academic',
  enabled: true,
};

export const mockDiscordStatusLinked: DiscordLinkStatus = {
  isLinked: true,
  eligibleForRole: 'student',
  inviteLink: 'https://discord.gg/cacic',
  discordLinks: [
    {
      id: 'link_1',
      userId: 'usr_1',
      discordId: '12345678901234567',
      discordUsername: 'joao',
      discordGlobalName: 'João',
      discordAvatarHash: 'abc123',
      isVerified: true,
      assignedRole: 'student',
      createdAt: new Date('2025-01-01T00:00:00.000Z'),
    },
  ],
};

export const mockDiscordStatusNotLinked: DiscordLinkStatus = {
  isLinked: false,
  eligibleForRole: 'visitor',
  inviteLink: undefined,
  discordLinks: [],
};

export const mockVerificationStatusNotSubmitted: VerificationStatus = {
  status: 'not_submitted',
};

export const mockVerificationStatusPending: VerificationStatus = {
  status: 'pending',
  submissionDate: new Date('2026-03-31T10:00:00.000Z'),
};

export const mockVerificationStatusApproved: VerificationStatus = {
  status: 'approved',
  submissionDate: new Date('2026-03-31T10:00:00.000Z'),
  verificationDate: new Date('2026-04-01T08:00:00.000Z'),
  authenticationCode: 'ABC123',
  extractedName: 'João Silva',
  isDocumentValid: true,
};

export const mockVerificationStatusRejected: VerificationStatus = {
  status: 'rejected',
  submissionDate: new Date('2026-03-31T10:00:00.000Z'),
  verificationDate: new Date('2026-04-01T08:00:00.000Z'),
  rejectionReason: 'Documento ilegível',
  isDocumentValid: false,
};

export const mockRoles: DiscordRole[] = [
  {
    id: 'role_1',
    name: 'Aluno',
    color: '#3f51b5',
    position: 10,
    hasPermissions: false,
    isBlacklisted: false,
    isEnabled: true,
    isManaged: false,
  },
  {
    id: 'role_2',
    name: 'Eventos',
    color: '#009688',
    position: 9,
    hasPermissions: false,
    isBlacklisted: false,
    isEnabled: true,
    isManaged: false,
  },
  {
    id: 'role_3',
    name: 'Staff',
    color: '#f44336',
    position: 20,
    hasPermissions: true,
    isBlacklisted: true,
    isEnabled: false,
    isManaged: true,
  },
];

export const mockUserRoles: UserRoles = {
  currentRoles: [mockRoles[0]],
  availableRoles: mockRoles.filter(
    (role) => role.isEnabled && !role.isBlacklisted,
  ),
};

const mockAdminRoleDiretoria: DiscordRole = {
  id: 'admin_role_1',
  name: 'Diretoria',
  color: '#f1c40f',
  position: 30,
  hasPermissions: true,
  isBlacklisted: false,
  isEnabled: true,
  isManaged: false,
};

const mockAdminRoleModeracao: DiscordRole = {
  id: 'admin_role_2',
  name: 'Moderação',
  color: '#e74c3c',
  position: 25,
  hasPermissions: true,
  isBlacklisted: false,
  isEnabled: false,
  isManaged: false,
};

const mockAdminRoleBot: DiscordRole = {
  id: 'admin_role_3',
  name: 'Bot',
  color: '#2c2f33',
  position: 24,
  hasPermissions: true,
  isBlacklisted: true,
  isEnabled: false,
  isManaged: true,
};

const mockAdminRoleAluno: DiscordRole = {
  id: 'admin_role_4',
  name: 'Aluno',
  color: '#5865f2',
  position: 20,
  hasPermissions: false,
  isBlacklisted: false,
  isEnabled: true,
  isManaged: false,
};

const mockAdminRoleEventos: DiscordRole = {
  id: 'admin_role_5',
  name: 'Eventos',
  color: '#2ecc71',
  position: 18,
  hasPermissions: false,
  isBlacklisted: false,
  isEnabled: true,
  isManaged: false,
};

const mockAdminRoleSemCor: DiscordRole = {
  id: 'admin_role_6',
  name: 'Sem cor personalizada',
  color: '#000000',
  position: 10,
  hasPermissions: false,
  isBlacklisted: false,
  isEnabled: false,
  isManaged: false,
};

export const mockAdminSelectableRoles: SelectableRoles = {
  rolesWithPermissions: [
    mockAdminRoleDiretoria,
    mockAdminRoleModeracao,
    mockAdminRoleBot,
  ],
  rolesWithoutPermissions: [
    mockAdminRoleAluno,
    mockAdminRoleEventos,
    mockAdminRoleSemCor,
  ],
  selectableRoles: [
    mockAdminRoleDiretoria,
    mockAdminRoleAluno,
    mockAdminRoleEventos,
  ],
};

export const mockServerSettings: ServerSetting[] = [
  {
    id: 's1',
    key: 'student_invite_link',
    value: 'https://discord.gg/cacic',
    description: 'Convite do servidor de Discord para estudantes',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  },
];
