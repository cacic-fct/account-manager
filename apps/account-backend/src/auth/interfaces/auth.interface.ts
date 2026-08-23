import type { Application, User } from '@cacic/shared-types';

export interface KeycloakUser {
  sub: string;
  email: string;
  email_verified: boolean;
  name: string;
  preferred_username: string;
  given_name: string;
  family_name: string;
  picture?: string;
}

export interface SessionUser {
  email: string;
  keycloakId: string;
  isOnboarded: boolean;
}

export type UserProfile = User & { keycloakId: string };

export interface KeycloakApplication {
  id: string;
  clientId: string;
  name: string;
  description?: string;
  baseUrl?: string;
  adminUrl?: string;
  enabled: boolean;
  publicClient: boolean;
  implicitFlowEnabled?: boolean;
  directAccessGrantsEnabled?: boolean;
  serviceAccountsEnabled?: boolean;
  authorizationServicesEnabled?: boolean;
  attributes?: Record<string, string>;
}

export type UserApplication = Application;
