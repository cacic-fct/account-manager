import type { UnespRole } from '../enums/unesp-role.enum';

export interface User {
  id: string;
  username: string;
  email: string;
  secondaryEmails?: string[];
  fullname: string;
  displayName: string;
  picture?: string;
  phone: string;
  enrollmentNumber?: string;
  identityDocument: string;
  passportCountry?: string;
  isForeigner: boolean;
  isOnboarded: boolean;
  unespRole?: UnespRole;
  unespRoleVerified?: boolean;
  externalUserVerified?: boolean;
  fullNameLocked?: boolean;
  keycloakId?: string;
  isAdmin?: boolean;
  adminGroups?: string[];
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateUserProfile {
  fullname: string;
  phone: string;
  enrollmentNumber?: string;
  identityDocument: string;
  isForeigner: boolean;
  unespRole?: UnespRole;
}

export interface AuthStatus {
  isAuthenticated: boolean;
  isOnboarded: boolean;
}

export interface Application {
  id: string;
  name: string;
  description?: string;
  url?: string;
  iconUrl?: string;
  category?: string;
  enabled: boolean;
}
