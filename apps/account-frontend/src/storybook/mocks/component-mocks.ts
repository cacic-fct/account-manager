import { fakerPT_BR as faker } from '@faker-js/faker';
import {
  AssignableKeycloakPermission,
  KEYCLOAK_PERMISSION_CATALOG,
  STUDENT_ENTITY_CATALOG,
  StudentEntityKey,
  UnespRole,
  type Application,
  type KeycloakPermissionGrant,
  type KeycloakPermissionUser,
  type StudentEntityMembership,
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

export const mockKeycloakPermissionCatalog = KEYCLOAK_PERMISSION_CATALOG;

export const mockStudentEntityCatalog = STUDENT_ENTITY_CATALOG;

export const mockKeycloakPermissionUsers = Array.from({ length: 8 }, (_, index) =>
  createPermissionUser(index),
);

export const createMockKeycloakPermissionGrant = (
  user: KeycloakPermissionUser,
  permission: AssignableKeycloakPermission,
  index: number,
  options: {
    membershipId?: string;
    validFrom?: Date | null;
    validUntil?: Date | null;
  } = {},
): KeycloakPermissionGrant => ({
  id: `grant-${user.id}-${index + 1}`,
  userId: user.id,
  userEmail: user.email,
  userDisplayName: user.displayName,
  studentEntityMembershipId: options.membershipId,
  permission,
  validFrom: options.validFrom?.toISOString() ?? null,
  validUntil: options.validUntil?.toISOString() ?? null,
  status:
    options.validFrom && options.validFrom > mockNow ? 'scheduled' : 'active',
  createdAt: addDays(mockNow, -21).toISOString(),
  createdById: 'storybook-admin',
  updatedAt: addDays(mockNow, -2).toISOString(),
  updatedById: 'storybook-admin',
  lastSyncedAt: addDays(mockNow, -1).toISOString(),
});

export const createMockStudentEntityMembership = (
  user: KeycloakPermissionUser,
  entity: StudentEntityKey,
  index: number,
  permissions: AssignableKeycloakPermission[],
): StudentEntityMembership => {
  const definition =
    mockStudentEntityCatalog.find((candidate) => candidate.key === entity) ??
    mockStudentEntityCatalog[0];
  const membershipId = `membership-${entity.toLowerCase()}-${index + 1}`;
  const mandateStart = addDays(mockNow, -45 - index * 7);
  const mandateEnd = addDays(mockNow, 285 - index * 11);

  return {
    id: membershipId,
    entity,
    keycloakGroupPath: definition.keycloakGroupPath,
    userId: user.id,
    userEmail: user.email,
    userDisplayName: user.displayName,
    mandateStart: mandateStart.toISOString(),
    mandateEnd: mandateEnd.toISOString(),
    status: 'active',
    permissionGrants: permissions.map((permission, permissionIndex) =>
      createMockKeycloakPermissionGrant(user, permission, permissionIndex, {
        membershipId,
        validFrom: mandateStart,
        validUntil: mandateEnd,
      }),
    ),
    createdAt: addDays(mockNow, -50).toISOString(),
    createdById: 'storybook-admin',
    updatedAt: addDays(mockNow, -3).toISOString(),
    updatedById: 'storybook-admin',
    lastSyncedAt: addDays(mockNow, -1).toISOString(),
  };
};

export const mockStudentEntityMemberships: StudentEntityMembership[] = [
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[0],
    StudentEntityKey.Cacic,
    0,
    [
      AssignableKeycloakPermission.AccountManagerAccess,
    ],
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[1],
    StudentEntityKey.Cacic,
    1,
    [AssignableKeycloakPermission.AccountManagerAccess],
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[2],
    StudentEntityKey.Cacic,
    2,
    [
      AssignableKeycloakPermission.AccountManagerSuperAdmin,
    ],
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[3],
    StudentEntityKey.Ejcomp,
    3,
    [AssignableKeycloakPermission.AccountManagerAccess],
  ),
  createMockStudentEntityMembership(
    mockKeycloakPermissionUsers[4],
    StudentEntityKey.Ejcomp,
    4,
    [
      AssignableKeycloakPermission.AccountManagerAccess,
    ],
  ),
];

export const mockDirectKeycloakPermissionGrant =
  createMockKeycloakPermissionGrant(
    mockKeycloakPermissionUsers[0],
    AssignableKeycloakPermission.AccountManagerSuperAdmin,
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
