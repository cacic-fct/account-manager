export interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  refresh_expires_in?: number;
}

export interface KeycloakUserData {
  id: string;
  email: string;
  username?: string;
  firstName?: string;
  lastName?: string;
  enabled?: boolean;
  attributes?: Record<string, string[]>;
}

export interface KeycloakRole {
  id?: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

export interface KeycloakClient {
  id: string;
  clientId: string;
}

export interface KeycloakGroup {
  id: string;
  name: string;
  path?: string;
}

export interface KeycloakFederatedIdentity {
  identityProvider: string;
  userId: string;
  userName: string;
}

export interface KeycloakValidationError {
  field: string;
  errorMessage: string;
  params?: string[];
}

export interface KeycloakErrorResponse {
  errors?: KeycloakValidationError[];
}

export type KeycloakClientAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'none';

export interface KeycloakTokenError {
  error?: string;
  errorDescription?: string;
  bodyPreview?: string;
  contentType?: string;
  headers?: Record<string, string | undefined>;
}
