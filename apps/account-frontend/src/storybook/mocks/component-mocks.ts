import type { Application, User } from '@cacic/shared-types';
import type {
  DiscordLinkStatus,
  DiscordRole,
  UserRoles,
  ServerSetting,
} from '../../app/shared/services/api.service';
import type { VerificationStatus } from '../../app/shared/services/student-verification/student-verification.service';
import { UnespRole } from '@cacic/shared-types';

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

export const mockServerSettings: ServerSetting[] = [
  {
    id: 's1',
    key: 'invite_link',
    value: 'https://discord.gg/cacic',
    description: 'Convite padrão do servidor',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  },
  {
    id: 's2',
    key: 'welcome_channel',
    value: '#boas-vindas',
    description: 'Canal de boas-vindas',
    updatedAt: new Date('2026-03-01T00:00:00.000Z'),
  },
];
