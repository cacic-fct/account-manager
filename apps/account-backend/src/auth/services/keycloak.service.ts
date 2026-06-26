import { Injectable, Logger } from '@nestjs/common';
import {
  KeycloakUser,
  KeycloakApplication,
} from '../interfaces/auth.interface';
import { KeycloakConnectionException } from '../exceptions/keycloak-connection.exception';

interface TokenResponse {
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

interface KeycloakRole {
  id?: string;
  name: string;
  description?: string;
  composite?: boolean;
  clientRole?: boolean;
  containerId?: string;
}

interface KeycloakClient {
  id: string;
  clientId: string;
}

interface KeycloakGroup {
  id: string;
  name: string;
  path?: string;
}

export interface KeycloakFederatedIdentity {
  identityProvider: string;
  userId: string;
  userName: string;
}

interface KeycloakValidationError {
  field: string;
  errorMessage: string;
  params?: string[];
}

interface KeycloakErrorResponse {
  errors?: KeycloakValidationError[];
}

type KeycloakClientAuthMethod =
  | 'client_secret_basic'
  | 'client_secret_post'
  | 'none';

interface KeycloakTokenError {
  error?: string;
  errorDescription?: string;
  rawBody?: string;
}

@Injectable()
export class KeycloakService {
  private readonly logger = new Logger(KeycloakService.name);
  private readonly keycloakUrl: string;
  private readonly realm: string;
  private readonly clientId: string;
  private readonly clientAuthMethod: KeycloakClientAuthMethod;
  private readonly clientSecret?: string;
  private readonly adminClientId: string;
  private readonly adminClientSecret?: string;
  private readonly clientUuidCache = new Map<string, string>();

  constructor() {
    this.keycloakUrl = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_URL',
      'https://sso.cacic.dev.br',
    );
    this.realm = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_REALM',
      'cacic-sso',
    );
    this.clientId = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_CLIENT_ID',
      'cacic-account-manager',
    );
    this.clientAuthMethod = this.resolveClientAuthMethod();
    this.clientSecret = this.resolveClientSecret();
    this.adminClientId = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_ADMIN_CLIENT_ID',
      'admin-cli',
    );
    this.adminClientSecret = this.readOptionalEnv(
      'KEYCLOAK_ADMIN_CLIENT_SECRET',
    );

    if (this.isProduction() && !this.adminClientSecret) {
      throw new Error(
        'KEYCLOAK_ADMIN_CLIENT_SECRET must be configured in production',
      );
    }
  }

  /**
   * Determine if an error is due to connectivity issues with Keycloak
   */
  private isConnectionError(error: unknown): boolean {
    // Check for common network errors
    const connectionErrorMessages = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'fetch failed',
      'Network request failed',
      'Failed to fetch',
    ];

    if (error instanceof Error) {
      return connectionErrorMessages.some(
        (msg) =>
          error.message.includes(msg) ||
          (error.cause instanceof Error && error.cause.message.includes(msg)),
      );
    }

    // Handle cases where error might be a string or other type
    if (typeof error === 'string') {
      return connectionErrorMessages.some((msg) => error.includes(msg));
    }

    return false;
  }

  private readEnvWithDevelopmentFallback(
    name: string,
    developmentFallback: string,
  ): string {
    const value = this.readOptionalEnv(name);
    if (value) {
      return value;
    }

    if (this.isProduction()) {
      throw new Error(`${name} must be configured in production`);
    }

    this.logger.warn(`${name} is not configured; using development fallback`, {
      developmentFallback,
    });
    return developmentFallback;
  }

  private readOptionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  }

  private isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  private resolveClientAuthMethod(): KeycloakClientAuthMethod {
    const configuredMethod =
      this.readOptionalEnv('KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD') ??
      this.readOptionalEnv('KEYCLOAK_CLIENT_AUTH_METHOD');
    if (!configuredMethod) {
      const hasClientSecret = !!this.readOptionalEnv('KEYCLOAK_CLIENT_SECRET');
      return hasClientSecret || this.isProduction()
        ? 'client_secret_basic'
        : 'none';
    }

    if (
      configuredMethod === 'client_secret_basic' ||
      configuredMethod === 'client_secret_post' ||
      configuredMethod === 'none'
    ) {
      return configuredMethod;
    }

    throw new Error(
      [
        'KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD must be client_secret_basic,',
        'client_secret_post, or none',
      ].join(' '),
    );
  }

  private resolveClientSecret(): string | undefined {
    const secret = this.readOptionalEnv('KEYCLOAK_CLIENT_SECRET');

    if (this.clientAuthMethod === 'none') {
      if (secret) {
        this.logger.warn(
          [
            'KEYCLOAK_CLIENT_SECRET is configured but',
            'token endpoint auth method is none; login token requests will',
            'not send it',
          ].join(' '),
        );
      }

      return undefined;
    }

    if (secret) {
      return secret;
    }

    if (this.isProduction()) {
      throw new Error(
        [
          'KEYCLOAK_CLIENT_SECRET must be configured in production for the',
          'Keycloak login client. Set KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD=none',
          'only when KEYCLOAK_CLIENT_ID is a public client.',
        ].join(' '),
      );
    }

    this.logger.warn(
      [
        'KEYCLOAK_CLIENT_SECRET is not configured; authorization-code login',
        'will only work if KEYCLOAK_CLIENT_ID is a public Keycloak client',
      ].join(' '),
    );
    return undefined;
  }

  private getAdminClientSecret(): string {
    if (!this.adminClientSecret) {
      throw new Error(
        [
          'KEYCLOAK_ADMIN_CLIENT_SECRET must be configured for Keycloak admin',
          'API calls',
        ].join(' '),
      );
    }

    return this.adminClientSecret;
  }

  private async readTokenError(
    response: Response,
  ): Promise<KeycloakTokenError> {
    try {
      const contentType = response.headers.get('content-type') ?? '';
      if (contentType.includes('application/json')) {
        const body = (await response.json()) as unknown;
        if (body && typeof body === 'object') {
          const record = body as Record<string, unknown>;
          return {
            error: this.readString(record['error']),
            errorDescription:
              this.readString(record['error_description']) ??
              this.readString(record['errorDescription']),
          };
        }
      }

      const rawBody = await response.text();
      return rawBody ? { rawBody: rawBody.slice(0, 500) } : {};
    } catch {
      return {};
    }
  }

  private readString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }

  getAuthUrl(
    redirectUri: string,
    state?: string,
    options?: {
      prompt?: 'none' | 'login';
      maxAge?: number;
      codeChallenge?: string;
      codeChallengeMethod?: 'S256';
    },
  ): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      kc_idp_hint: 'google',
      ...(state && { state }),
      ...(options?.prompt && { prompt: options.prompt }),
      ...(options?.maxAge !== undefined && { max_age: String(options.maxAge) }),
      ...(options?.codeChallenge && {
        code_challenge: options.codeChallenge,
        code_challenge_method: options.codeChallengeMethod ?? 'S256',
      }),
    });

    return `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/auth?${params.toString()}`;
  }

  getEndSessionUrl(
    postLogoutRedirectUri: string,
    idTokenHint?: string,
  ): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
      ...(idTokenHint && { id_token_hint: idTokenHint }),
    });

    return `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/logout?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in?: number;
    refresh_expires_in?: number;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', this.clientId);
    body.set('code', code);
    body.set('redirect_uri', redirectUri);
    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }
    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);
      this.logger.warn('Failed to exchange code for tokens', {
        status: response.status,
        statusText: response.statusText,
        clientId: this.clientId,
        clientAuthMethod: this.clientAuthMethod,
        redirectUri,
        pkce: !!codeVerifier,
        error: details.error,
        errorDescription: details.errorDescription,
        rawBody: details.rawBody,
      });
      throw new Error('Failed to exchange code for tokens');
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in?: number;
      refresh_expires_in?: number;
    }>;
  }

  async getUserInfo(accessToken: string): Promise<KeycloakUser> {
    const userInfoUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/userinfo`;

    const response = await fetch(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to get user info');
    }

    const userInfo = (await response.json()) as KeycloakUser;

    // Debug logging to see what we're getting from Keycloak
    this.logger.debug('Keycloak user info received', {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      pictureExists: !!userInfo.picture,
    });

    return userInfo;
  }

  async refreshToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('client_id', this.clientId);
    body.set('refresh_token', refreshToken);
    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to refresh token');
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
    }>;
  }

  async logout(refreshToken: string): Promise<void> {
    const logoutUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/logout`;

    const body = new URLSearchParams();
    body.set('client_id', this.clientId);
    body.set('refresh_token', refreshToken);
    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    const response = await fetch(logoutUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error('Failed to logout from Keycloak');
    }
  }

  private appendClientAuthentication(
    body: URLSearchParams,
    headers: Record<string, string>,
  ): void {
    if (this.clientAuthMethod === 'none') {
      return;
    }

    const clientSecret = this.getLoginClientSecret();
    if (this.clientAuthMethod === 'client_secret_post') {
      body.set('client_secret', clientSecret);
      return;
    }

    body.delete('client_id');
    headers.Authorization = `Basic ${this.getClientSecretBasicCredentials(
      clientSecret,
    )}`;
  }

  private getLoginClientSecret(): string {
    if (!this.clientSecret) {
      throw new Error(
        [
          'KEYCLOAK_CLIENT_SECRET must be configured for',
          `${this.clientAuthMethod} authentication`,
        ].join(' '),
      );
    }

    return this.clientSecret;
  }

  private getClientSecretBasicCredentials(clientSecret: string): string {
    return Buffer.from(
      `${this.formEncode(this.clientId)}:${this.formEncode(clientSecret)}`,
      'utf8',
    ).toString('base64');
  }

  private formEncode(value: string): string {
    const params = new URLSearchParams();
    params.set('value', value);
    return params.toString().slice('value='.length);
  }

  private createFormHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }

  async getAdminToken(): Promise<string> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.adminClientId,
      client_secret: this.getAdminClientSecret(),
    });

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: body.toString(),
      });

      if (!response.ok) {
        const details = await this.readTokenError(response);
        this.logger.warn('Failed to get Keycloak admin token', {
          status: response.status,
          statusText: response.statusText,
          clientId: this.adminClientId,
          error: details.error,
          errorDescription: details.errorDescription,
          rawBody: details.rawBody,
        });
        throw new Error('Failed to get admin token');
      }

      const data = (await response.json()) as TokenResponse;
      return data.access_token;
    } catch (error) {
      if (this.isConnectionError(error)) {
        throw new KeycloakConnectionException(
          'Unable to connect to authentication service to verify user status',
          error instanceof Error ? error : undefined,
        );
      }
      throw error;
    }
  }

  async updateUserAttributes(
    userId: string,
    attributes: Record<string, string | string[]>,
    options: { skipValidation?: boolean } = {},
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    // First, get the current user data
    const getUserResponse = await fetch(userUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!getUserResponse.ok) {
      throw new Error('Failed to get current user data');
    }

    const currentUser = (await getUserResponse.json()) as KeycloakUserData;

    // Define required attributes that must have values (using Keycloak's expected field names)
    const requiredAttributes = ['identity-document', 'phone', 'fullName'];

    // Merge new attributes with existing ones
    const updatedAttributes = {
      ...currentUser.attributes,
      ...attributes,
    };

    // Validate that required attributes are present and not empty (unless skipping validation)
    if (!options.skipValidation) {
      const missingRequiredAttributes: string[] = [];
      for (const requiredAttr of requiredAttributes) {
        const value = updatedAttributes[requiredAttr];
        if (
          !value ||
          (Array.isArray(value) && (value.length === 0 || !value[0])) ||
          (typeof value === 'string' && value.trim() === '')
        ) {
          missingRequiredAttributes.push(requiredAttr);
        }
      }

      if (missingRequiredAttributes.length > 0) {
        throw new Error(
          `User must complete onboarding. Missing required attributes: ${missingRequiredAttributes.join(', ')}`,
        );
      }
    }

    // Ensure all attribute values are properly formatted (arrays for Keycloak)
    const formattedAttributes: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(updatedAttributes)) {
      if (Array.isArray(value)) {
        const filteredValue = value.filter((v) => v && v.trim() !== '');
        // Only include attributes that have valid values, or when skipping validation for required fields
        if (
          filteredValue.length > 0 ||
          (options.skipValidation && requiredAttributes.includes(key))
        ) {
          formattedAttributes[key] =
            filteredValue.length > 0 ? filteredValue : [''];
        }
      } else if (value && typeof value === 'string') {
        const trimmedValue = value.trim();
        if (trimmedValue !== '') {
          formattedAttributes[key] = [trimmedValue];
        } else if (options.skipValidation && requiredAttributes.includes(key)) {
          // For required fields when skipping validation, provide an empty string
          formattedAttributes[key] = [''];
        }
      } else if (options.skipValidation && requiredAttributes.includes(key)) {
        // For required fields when skipping validation and value is null/undefined, provide empty string
        formattedAttributes[key] = [''];
      }
    }

    // When skipping validation, ensure all required attributes are present with at least empty values
    if (options.skipValidation) {
      for (const requiredAttr of requiredAttributes) {
        if (!formattedAttributes[requiredAttr]) {
          formattedAttributes[requiredAttr] = [''];
        }
      }
    }

    // Update the user with the merged attributes
    const updateResponse = await fetch(userUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...currentUser,
        attributes: formattedAttributes,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();
      this.logger.error('Update user attributes failed', {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        error: errorText,
      });

      // Parse Keycloak validation errors if available
      try {
        const errorData = JSON.parse(errorText) as KeycloakErrorResponse;
        if (errorData.errors && Array.isArray(errorData.errors)) {
          const validationErrors = errorData.errors
            .map((err) => `${err.field}: ${err.errorMessage}`)
            .join(', ');
          throw new Error(`Validation failed: ${validationErrors}`);
        }
      } catch {
        // If parsing fails, use original error
      }

      throw new Error(
        `Failed to update user attributes: ${updateResponse.status} ${updateResponse.statusText}`,
      );
    }
  }

  async getUserAttributes(userId: string): Promise<Record<string, string[]>> {
    try {
      const adminToken = await this.getAdminToken();
      const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

      this.logger.debug('Getting user attributes', { userId, userUrl });

      const response = await fetch(userUrl, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        this.logger.error('Failed to get user attributes', {
          status: response.status,
          statusText: response.statusText,
          userId,
          url: userUrl,
        });

        if (response.status === 404) {
          throw new Error(`User with ID ${userId} not found in Keycloak`);
        }

        throw new Error(
          `Failed to get user attributes: ${response.status} ${response.statusText}`,
        );
      }

      const userData = (await response.json()) as KeycloakUserData;
      this.logger.debug('User attributes retrieved', {
        id: userData.id,
        email: userData.email,
        attributesKeys: Object.keys(userData.attributes || {}),
      });
      return userData.attributes || {};
    } catch (error) {
      // If it's already a KeycloakConnectionException, just re-throw it
      if (error instanceof KeycloakConnectionException) {
        throw error;
      }

      // Check if this is a connection error and wrap it
      if (this.isConnectionError(error)) {
        throw new KeycloakConnectionException(
          'Unable to connect to authentication service to verify user status',
          error instanceof Error ? error : undefined,
        );
      }

      // Re-throw other errors as-is
      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<KeycloakUserData | null> {
    const adminToken = await this.getAdminToken();
    const usersUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`;

    const response = await fetch(usersUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to find user by email');
    }

    const users = (await response.json()) as KeycloakUserData[];
    return users.length > 0 ? users[0] : null;
  }

  async searchUsers(
    query: string,
    options: { max?: number } = {},
  ): Promise<KeycloakUserData[]> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) {
      return [];
    }

    const adminToken = await this.getAdminToken();
    const max = Math.min(Math.max(options.max ?? 10, 1), 50);
    const requestUrls = new Set<string>();
    const addSearchUrl = (params: Record<string, string>) => {
      const searchParams = new URLSearchParams({
        first: '0',
        max: String(max),
        briefRepresentation: 'false',
        ...params,
      });
      requestUrls.add(
        `${this.keycloakUrl}/admin/realms/${this.realm}/users?${searchParams.toString()}`,
      );
    };

    addSearchUrl({ search: normalizedQuery });
    addSearchUrl({ q: `identity-document:${normalizedQuery}` });
    addSearchUrl({ q: `identityDocument:${normalizedQuery}` });
    addSearchUrl({ q: `fullName:${normalizedQuery}` });

    if (normalizedQuery.includes('@')) {
      addSearchUrl({ email: normalizedQuery });
      addSearchUrl({ email: normalizedQuery, exact: 'true' });
    }

    const responses = await Promise.allSettled(
      [...requestUrls].map(async (url) => {
        const response = await fetch(url, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        if (!response.ok) {
          throw new Error(
            `Failed to search users: ${response.status} ${response.statusText}`,
          );
        }

        return (await response.json()) as KeycloakUserData[];
      }),
    );

    const usersById = new Map<string, KeycloakUserData>();
    for (const response of responses) {
      if (response.status === 'rejected') {
        this.logger.warn('Keycloak user search branch failed', response.reason);
        continue;
      }

      for (const user of response.value) {
        usersById.set(user.id, user);
      }
    }

    return [...usersById.values()].slice(0, max);
  }

  async getUserGroups(userId: string): Promise<string[]> {
    const adminToken = await this.getAdminToken();
    const userGroupsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/groups`;

    this.logger.debug('Getting user groups', { userId });

    const response = await fetch(userGroupsUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('User not found when getting groups', { userId });
        return [];
      }

      this.logger.error('Failed to get user groups', {
        status: response.status,
        statusText: response.statusText,
        userId,
      });
      throw new Error(
        `Failed to get user groups: ${response.status} ${response.statusText}`,
      );
    }

    const groups = (await response.json()) as Array<{ name: string }>;
    this.logger.debug('User groups retrieved', {
      userId,
      groups: groups.map((g) => g.name),
    });
    return groups.map((group) => group.name);
  }

  async getUserRoles(userId: string): Promise<string[]> {
    return this.getUserClientRoles(userId);
  }

  /**
   * Get only direct role assignments for a user (not inherited from groups)
   */
  async getUserDirectRoles(userId: string): Promise<string[]> {
    return this.getUserDirectClientRoles(userId);
  }

  async getUserClientRoles(
    userId: string,
    clientId = this.clientId,
  ): Promise<string[]> {
    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const userRolesUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/clients/${clientUuid}/composite`;

    this.logger.debug('Getting user client roles (including inherited)', {
      userId,
      clientId,
    });

    const response = await fetch(userRolesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('User not found when getting client roles', {
          userId,
          clientId,
        });
        return [];
      }

      this.logger.error('Failed to get user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
      });
      throw new Error(
        `Failed to get user client roles: ${response.status} ${response.statusText}`,
      );
    }

    const roles = (await response.json()) as Array<{ name: string }>;
    this.logger.debug('User client roles retrieved (including inherited)', {
      userId,
      clientId,
      roles: roles.map((r) => r.name),
    });
    return roles.map((role) => role.name);
  }

  async getUserDirectClientRoles(
    userId: string,
    clientId = this.clientId,
  ): Promise<string[]> {
    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const userRolesUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/clients/${clientUuid}`;

    this.logger.debug('Getting direct user client roles', {
      userId,
      clientId,
    });

    const response = await fetch(userRolesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('User not found when getting direct client roles', {
          userId,
          clientId,
        });
        return [];
      }

      this.logger.error('Failed to get direct user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
      });
      throw new Error(
        `Failed to get direct user client roles: ${response.status} ${response.statusText}`,
      );
    }

    const roles = (await response.json()) as Array<{ name: string }>;
    this.logger.debug('Direct user client roles retrieved', {
      userId,
      clientId,
      roles: roles.map((r) => r.name),
    });
    return roles.map((role) => role.name);
  }

  async addUserClientRoles(
    userId: string,
    roleNames: readonly string[],
    clientId = this.clientId,
  ): Promise<void> {
    const roles = await this.getClientRolesByName(clientId, roleNames);
    if (roles.length === 0) {
      return;
    }

    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId);
    const roleMappingsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/clients/${clientUuid}`;
    const response = await fetch(roleMappingsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(roles),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to assign user client roles: ${response.status} ${response.statusText}`,
      );
    }
  }

  async removeUserClientRoles(
    userId: string,
    roleNames: readonly string[],
    clientId = this.clientId,
  ): Promise<void> {
    const roles = await this.getClientRolesByName(clientId, roleNames);
    if (roles.length === 0) {
      return;
    }

    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId);
    const roleMappingsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/role-mappings/clients/${clientUuid}`;
    const response = await fetch(roleMappingsUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(roles),
    });

    if (!response.ok) {
      throw new Error(
        `Failed to remove user client roles: ${response.status} ${response.statusText}`,
      );
    }
  }

  async addUserToGroupPath(userId: string, groupPath: string): Promise<void> {
    const group = await this.getGroupByPath(groupPath);
    const adminToken = await this.getAdminToken();
    const groupUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/groups/${group.id}`;
    const response = await fetch(groupUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to add user to Keycloak group ${groupPath}: ${response.status} ${response.statusText}`,
      );
    }
  }

  async removeUserFromGroupPath(
    userId: string,
    groupPath: string,
  ): Promise<void> {
    const group = await this.getGroupByPath(groupPath);
    const adminToken = await this.getAdminToken();
    const groupUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/groups/${group.id}`;
    const response = await fetch(groupUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to remove user from Keycloak group ${groupPath}: ${response.status} ${response.statusText}`,
      );
    }
  }

  private async getClientRolesByName(
    clientId: string,
    roleNames: readonly string[],
  ): Promise<KeycloakRole[]> {
    const normalizedRoleNames = [
      ...new Set(roleNames.map((role) => role.trim())),
    ].filter((role) => role.length > 0);
    if (normalizedRoleNames.length === 0) {
      return [];
    }

    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);

    const roles = await Promise.all(
      normalizedRoleNames.map(async (roleName) => {
        const roleUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/clients/${clientUuid}/roles/${encodeURIComponent(
          roleName,
        )}`;
        const response = await fetch(roleUrl, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        if (!response.ok) {
          if (response.status === 404) {
            throw new Error(
              `Keycloak client role ${clientId}:${roleName} was not found`,
            );
          }

          throw new Error(
            `Failed to get client role ${clientId}:${roleName}: ${response.status} ${response.statusText}`,
          );
        }

        return (await response.json()) as KeycloakRole;
      }),
    );

    return roles;
  }

  private async getClientUuid(
    clientId: string,
    adminToken?: string,
  ): Promise<string> {
    const normalizedClientId = clientId.trim();
    if (!normalizedClientId) {
      throw new Error('Keycloak client id is required');
    }

    const cachedUuid = this.clientUuidCache.get(normalizedClientId);
    if (cachedUuid) {
      return cachedUuid;
    }

    const token = adminToken ?? (await this.getAdminToken());
    const clientsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/clients?clientId=${encodeURIComponent(
      normalizedClientId,
    )}`;
    const response = await fetch(clientsUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(
        `Failed to find Keycloak client ${normalizedClientId}: ${response.status} ${response.statusText}`,
      );
    }

    const clients = (await response.json()) as KeycloakClient[];
    const client = clients.find(
      (candidate) => candidate.clientId === normalizedClientId,
    );
    if (!client) {
      throw new Error(`Keycloak client ${normalizedClientId} was not found`);
    }

    this.clientUuidCache.set(normalizedClientId, client.id);
    return client.id;
  }

  private async getGroupByPath(groupPath: string): Promise<KeycloakGroup> {
    const normalizedPath = groupPath.trim().replace(/^\/+/, '');
    if (!normalizedPath) {
      throw new Error('Keycloak group path is required');
    }

    const adminToken = await this.getAdminToken();
    const encodedPath = normalizedPath
      .split('/')
      .map((segment) => encodeURIComponent(segment))
      .join('/');
    const groupUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/group-by-path/${encodedPath}`;
    const response = await fetch(groupUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Keycloak group ${groupPath} was not found`);
      }

      throw new Error(
        `Failed to get Keycloak group ${groupPath}: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as KeycloakGroup;
  }

  async getUserBasicInfo(userId: string): Promise<KeycloakUserData | null> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    this.logger.debug('Getting basic user info', { userId });

    const response = await fetch(userUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('User not found in Keycloak', { userId });
        return null;
      }

      this.logger.error('Failed to get basic user info', {
        status: response.status,
        statusText: response.statusText,
        userId,
      });
      throw new Error(
        `Failed to get basic user info: ${response.status} ${response.statusText}`,
      );
    }

    const userData = (await response.json()) as KeycloakUserData;
    this.logger.debug('Basic user info retrieved', {
      id: userData.id,
      email: userData.email,
    });
    return userData;
  }

  async updateUser(
    userId: string,
    data: Partial<KeycloakUserData>,
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    const currentResponse = await fetch(userUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!currentResponse.ok) {
      throw new Error(
        `Failed to get current user before update: ${currentResponse.status} ${currentResponse.statusText}`,
      );
    }

    const currentUser = (await currentResponse.json()) as KeycloakUserData;
    const updateResponse = await fetch(userUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...currentUser,
        ...data,
      }),
    });

    if (!updateResponse.ok) {
      throw new Error(
        `Failed to update user: ${updateResponse.status} ${updateResponse.statusText}`,
      );
    }
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.updateUser(userId, { enabled });
  }

  async getFederatedIdentities(
    userId: string,
  ): Promise<KeycloakFederatedIdentity[]> {
    const adminToken = await this.getAdminToken();
    const identitiesUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/federated-identity`;

    const response = await fetch(identitiesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }

      throw new Error(
        `Failed to get federated identities: ${response.status} ${response.statusText}`,
      );
    }

    return (await response.json()) as KeycloakFederatedIdentity[];
  }

  async addFederatedIdentity(
    userId: string,
    identity: KeycloakFederatedIdentity,
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const identityUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/federated-identity/${encodeURIComponent(
      identity.identityProvider,
    )}`;

    const response = await fetch(identityUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(identity),
    });

    if (!response.ok && response.status !== 409) {
      throw new Error(
        `Failed to add federated identity: ${response.status} ${response.statusText}`,
      );
    }
  }

  async removeFederatedIdentity(
    userId: string,
    identityProvider: string,
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const identityUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/federated-identity/${encodeURIComponent(
      identityProvider,
    )}`;

    const response = await fetch(identityUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      throw new Error(
        `Failed to remove federated identity: ${response.status} ${response.statusText}`,
      );
    }
  }

  async getUserApplications(userId: string): Promise<KeycloakApplication[]> {
    try {
      const adminToken = await this.getAdminToken();

      // Get all clients in the realm
      const clientsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/clients`;

      this.logger.debug('Getting applications for user', { userId });

      const response = await fetch(clientsUrl, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        this.logger.error('Failed to get applications', {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(
          `Failed to get applications: ${response.status} ${response.statusText}`,
        );
      }

      const clients = (await response.json()) as KeycloakApplication[];

      // Filter clients that are actual applications (not technical clients)
      const applications = clients.filter((client) => {
        // Exclude technical clients like admin-cli, realm-management, etc.
        const technicalClients = [
          'admin-cli',
          'realm-management',
          'security-admin-console',
          'account-console',
          'broker',
          'account',
          'cacic-account-manager',
        ];

        return (
          client.enabled &&
          !technicalClients.includes(client.clientId) &&
          client.name &&
          client.name.trim() !== '' &&
          // Include only public clients or clients with base URL (user-facing apps)
          (client.publicClient || client.baseUrl)
        );
      });

      this.logger.verbose('Applications found for user', {
        userId,
        totalClients: clients.length,
        applications: applications.length,
        apps: applications.map((app) => ({
          id: app.id,
          clientId: app.clientId,
          name: app.name,
          baseUrl: app.baseUrl,
        })),
      });

      return applications;
    } catch (error) {
      this.logger.error('Error getting user applications', error);
      return [];
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    this.logger.debug('Deleting user from Keycloak', { userId });

    const response = await fetch(userUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn(
          'User not found in Keycloak, may have been already deleted',
          { userId },
        );
        return; // User already deleted, consider it success
      }

      this.logger.error('Failed to delete user from Keycloak', {
        status: response.status,
        statusText: response.statusText,
        userId,
      });

      throw new Error(
        `Failed to delete user from Keycloak: ${response.status} ${response.statusText}`,
      );
    }
    this.logger.log('User successfully deleted from Keycloak', { userId });
  }

  /**
   * Set the Unesp role verification status
   */
  async setUnespRoleVerified(userId: string, verified: boolean): Promise<void> {
    await this.updateUserAttributes(
      userId,
      {
        unespRoleVerified: [verified.toString()],
      },
      { skipValidation: true },
    );
  }

  /**
   * Get the Unesp role verification status
   */
  async getUnespRoleVerified(userId: string): Promise<boolean> {
    const attributes = await this.getUserAttributes(userId);
    const verified = attributes.unespRoleVerified?.[0];
    return verified === 'true';
  }

  /**
   * Invalidate Unesp role verification (set to false)
   */
  async invalidateUnespRoleVerification(userId: string): Promise<void> {
    await this.setUnespRoleVerified(userId, false);
  }

  /**
   * Verify a user's Unesp role (for professors or admin verification)
   * This can be used by manual approval processes or other verification methods
   */
  async verifyUserUnespRole(
    userId: string,
    verifiedBy: string,
    verificationMethod: 'document' | 'manual' | 'admin',
  ): Promise<void> {
    this.logger.verbose('Verifying Unesp role for user', {
      userId,
      verifiedBy,
      verificationMethod,
      timestamp: new Date().toISOString(),
    });

    await this.setUnespRoleVerified(userId, true);

    // Log the verification action for audit purposes
    await this.updateUserAttributes(
      userId,
      {
        unespRoleVerificationMethod: [verificationMethod],
        unespRoleVerifiedBy: [verifiedBy],
        unespRoleVerificationDate: [new Date().toISOString()],
      },
      { skipValidation: true },
    );
  }
}
