export interface DiscordRole {
  id: string;
  name: string;
  color: string;
  position: number;
  hasPermissions: boolean;
  isBlacklisted: boolean;
  isEnabled: boolean;
  isManaged: boolean;
}

export interface SelectableRoles {
  rolesWithPermissions: DiscordRole[];
  rolesWithoutPermissions: DiscordRole[];
  selectableRoles: DiscordRole[];
}

export interface UpdateRoleSelection {
  enabledRoleIds: string[];
}

export interface UserRoleSelection {
  selectedRoleIds: string[];
}

export interface UserRoles {
  currentRoles: DiscordRole[];
  availableRoles: DiscordRole[];
}

export interface RoleSelectionResponse {
  message: string;
  updatedRoles: DiscordRole[];
}

export type DiscordManagedRoleCategory = 'student' | 'unesp' | 'visitor';

export interface DiscordManagedRoleDefinition {
  category: DiscordManagedRoleCategory;
  roleId: string;
  roleName: string;
  label: string;
  description: string;
}

export interface DiscordManagedRoleOverride {
  id: string;
  userId: string;
  userEmail?: string;
  userDisplayName?: string;
  roleCategory: DiscordManagedRoleCategory;
  roleLabel: string;
  roleId: string;
  roleName: string;
  reason?: string;
  createdAt: string;
  createdById?: string;
  updatedAt: string;
  updatedById?: string;
}

export interface DiscordManagedRoleOverrideCreateRequest {
  userId: string;
  roleCategory: DiscordManagedRoleCategory;
  reason?: string;
}

export type DiscordManagedRoleOverrideUpdateRequest = Partial<Omit<DiscordManagedRoleOverrideCreateRequest, 'userId'>>;

export interface DiscordLink {
  id: string;
  userId: string;
  discordId: string;
  discordUsername: string;
  discordGlobalName: string;
  discordAvatarHash?: string;
  isVerified: boolean;
  assignedRole?: string;
  createdAt: Date;
}

export interface DiscordLinkStatus {
  isLinked: boolean;
  discordLinks?: DiscordLink[];
  inviteLink?: string;
  eligibleForRole: 'student' | 'unesp' | 'visitor';
}

export interface DiscordAuthUrl {
  authUrl: string;
}

export interface ServerSetting {
  id: string;
  key: string;
  value: string;
  description: string;
  updatedAt: Date;
}

export interface UpdateServerSetting {
  value: string;
}
