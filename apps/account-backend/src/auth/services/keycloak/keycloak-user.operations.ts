import { BadRequestException, ConflictException } from '@nestjs/common';
import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';
import { KeycloakErrorResponse, KeycloakFederatedIdentity, KeycloakUserData } from './keycloak.types';
import { KeycloakAdminOperations } from './keycloak-admin.operations';

export abstract class KeycloakUserOperations extends KeycloakAdminOperations {
  private readonly userUpdateListeners = new Set<(userId: string) => Promise<void>>();
  private readonly pendingUserUpdates = new Map<string, Promise<void>>();

  protected async serializeUserUpdate(userId: string, update: () => Promise<void>): Promise<void> {
    const previous = this.pendingUserUpdates.get(userId) ?? Promise.resolve();
    const request = previous.then(update);
    const completion = request.then(
      () => undefined,
      () => undefined,
    );
    this.pendingUserUpdates.set(userId, completion);
    try {
      await request;
    } finally {
      if (this.pendingUserUpdates.get(userId) === completion) {
        this.pendingUserUpdates.delete(userId);
      }
    }
  }

  onUserUpdated(listener: (userId: string) => Promise<void>): () => void {
    this.userUpdateListeners.add(listener);
    return () => this.userUpdateListeners.delete(listener);
  }

  protected async notifyUserUpdated(userId: string): Promise<void> {
    for (const listener of this.userUpdateListeners) {
      try {
        await listener(userId);
      } catch (error) {
        // The identity mutation has succeeded; scheduled reconciliation retries failed consumers.
        this.logger.warn(`Failed to synchronize updated Keycloak user ${userId}`, error);
      }
    }
  }

  async updateUserAttributes(
    userId: string,
    attributes: Record<string, string | string[]>,
    options: { skipValidation?: boolean; mode?: 'merge' | 'replace' } = {},
  ): Promise<void> {
    await this.serializeUserUpdate(userId, () => this.saveUserAttributes(userId, attributes, options));
    await this.notifyUserUpdated(userId);
  }

  protected async saveUserAttributes(
    userId: string,
    attributes: Record<string, string | string[]>,
    options: { skipValidation?: boolean; mode?: 'merge' | 'replace' },
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;

    const getUserResponse = await this.fetchWithTimeout(userUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!getUserResponse.ok) {
      const details = await this.readTokenError(getUserResponse);

      this.logger.warn('Failed to get current Keycloak user data', {
        status: getUserResponse.status,
        statusText: getUserResponse.statusText,
        userUrl,
        userId,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to get current user data');
    }

    const currentUser = await this.readUserData(getUserResponse, userId);

    const requiredAttributes = ['identity-document', 'phone', 'fullName'];

    const updatedAttributes = {
      ...(options.mode === 'replace' ? {} : currentUser.attributes),
      ...attributes,
    };

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

    const formattedAttributes: Record<string, string[]> = {};

    for (const [key, value] of Object.entries(updatedAttributes)) {
      if (Array.isArray(value)) {
        const filteredValue = value.filter((v) => v && v.trim() !== '');

        if (filteredValue.length > 0 || (options.skipValidation && requiredAttributes.includes(key))) {
          formattedAttributes[key] = filteredValue.length > 0 ? filteredValue : [''];
        }
      } else if (value && typeof value === 'string') {
        const trimmedValue = value.trim();

        if (trimmedValue !== '') {
          formattedAttributes[key] = [trimmedValue];
        } else if (options.skipValidation && requiredAttributes.includes(key)) {
          formattedAttributes[key] = [''];
        }
      } else if (options.skipValidation && requiredAttributes.includes(key)) {
        formattedAttributes[key] = [''];
      }
    }

    if (options.skipValidation) {
      for (const requiredAttr of requiredAttributes) {
        if (!formattedAttributes[requiredAttr]) {
          formattedAttributes[requiredAttr] = [''];
        }
      }
    }

    const updateResponse = await this.fetchWithTimeout(userUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        // User-profile validation needs the root profile fields when replacing attributes.
        // Do not replay enabled, emailVerified, requiredActions, or other security state.
        username: currentUser.username,
        email: currentUser.email,
        firstName: currentUser.firstName,
        lastName: currentUser.lastName,
        attributes: formattedAttributes,
      }),
    });

    if (!updateResponse.ok) {
      const errorText = await updateResponse.text();

      this.logger.error('Update user attributes failed', {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        responseHeaders: this.readResponseDebugHeaders(updateResponse),
      });

      let errorData: KeycloakErrorResponse | undefined;
      try {
        errorData = JSON.parse(errorText) as KeycloakErrorResponse;
      } catch {
        // If parsing fails, use original error below.
      }
      if (Array.isArray(errorData?.errors)) {
        const validationErrors = errorData.errors.map((err) => `${err.field}: ${err.errorMessage}`).join(', ');
        throw new Error(`Validation failed: ${validationErrors}`);
      }

      throw new Error(`Failed to update user attributes: ${updateResponse.status} ${updateResponse.statusText}`);
    }
    // Another replica may update unrelated attributes before the verification read.
    // Replacement also needs to verify the removal of keys omitted by the caller.
    const expectedKeys = new Set([
      ...Object.keys(attributes),
      ...(options.mode === 'replace' ? Object.keys(currentUser.attributes ?? {}) : []),
    ]);
    const expectedAttributes = Object.fromEntries(
      [...expectedKeys].map((key) => [key, formattedAttributes[key] ?? []]),
    );
    await this.verifyUserAttributes(userUrl, userId, adminToken, expectedAttributes);
  }

  private async verifyUserAttributes(
    userUrl: string,
    userId: string,
    adminToken: string,
    expected: Record<string, string[]>,
  ): Promise<void> {
    const response = await this.fetchWithTimeout(userUrl, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    if (!response.ok) {
      throw new KeycloakConnectionException('Unable to confirm saved account attributes');
    }
    const saved = await this.readUserData(response, userId);
    // Keycloak represents these fields at the root, rather than in attributes.
    const rootAttributes = new Set(['username', 'email', 'firstName', 'lastName']);
    const unsavedKeys = Object.keys(expected).filter((key) => {
      if (rootAttributes.has(key)) return false;
      const expectedValues = expected[key].filter((value) => value.trim() !== '');
      const actualValues = saved.attributes?.[key]?.filter((value) => value.trim() !== '') ?? [];
      return JSON.stringify(expectedValues) !== JSON.stringify(actualValues);
    });
    if (unsavedKeys.length > 0) {
      this.logger.error('Keycloak did not persist user attributes; check User Profile permissions', {
        userId,
        unsavedKeys,
      });
      throw new KeycloakConnectionException('Authentication service did not persist the requested account attributes');
    }
  }

  async getUserAttributes(userId: string): Promise<Record<string, string[]>> {
    try {
      const adminToken = await this.getAdminToken();
      const userUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;

      this.logger.debug('Getting user attributes', { userId, userUrl });

      const response = await this.fetchWithTimeout(userUrl, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        const details = await this.readTokenError(response);

        this.logger.error('Failed to get user attributes', {
          status: response.status,
          statusText: response.statusText,
          userId,
          url: userUrl,
          contentType: details.contentType,
          responseHeaders: details.headers,
        });

        if (response.status === 404) {
          throw new Error(`User with ID ${userId} not found in Keycloak`);
        }

        throw new Error(`Failed to get user attributes: ${response.status} ${response.statusText}`);
      }

      const userData = await this.readUserData(response, userId);

      this.logger.debug('User attributes retrieved', {
        id: userData.id,
        attributesKeys: Object.keys(userData.attributes || {}),
      });

      return userData.attributes || {};
    } catch (error) {
      if (error instanceof KeycloakConnectionException) {
        throw error;
      }

      if (this.isConnectionError(error)) {
        throw new KeycloakConnectionException(
          'Unable to connect to authentication service to verify user status',
          error instanceof Error ? error : undefined,
        );
      }

      throw error;
    }
  }

  async findUserByEmail(email: string): Promise<KeycloakUserData | null> {
    const normalizedEmail = email.trim().toLowerCase();
    if (!normalizedEmail) {
      return null;
    }
    const adminToken = await this.getAdminToken();
    const usersUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users?email=${encodeURIComponent(normalizedEmail)}&exact=true&first=0&max=2&briefRepresentation=false`;

    const response = await this.fetchWithTimeout(usersUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to find user by email', {
        status: response.status,
        statusText: response.statusText,
        usersUrl,
        email,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to find user by email');
    }

    const users = await this.readUserList(response);
    if (!Array.isArray(users) || users.some((user) => user.email?.trim().toLowerCase() !== normalizedEmail)) {
      throw new KeycloakConnectionException('Authentication service returned invalid email lookup results');
    }
    if (users.length > 1) {
      throw new ConflictException('Mais de uma conta foi encontrada com este e-mail. Entre em contato com o suporte.');
    }
    return users[0] ?? null;
  }

  async searchUsers(query: string, options: { max?: number } = {}): Promise<KeycloakUserData[]> {
    const normalizedQuery = query.trim();

    if (normalizedQuery.length < 2) {
      return [];
    }

    const max = this.getSearchLimit(options.max);
    const adminToken = await this.getAdminToken();
    const requestUrls = new Set<string>();

    const addSearchUrl = (params: Record<string, string>) => {
      const searchParams = new URLSearchParams({
        first: '0',
        max: String(max),
        briefRepresentation: 'false',
        ...params,
      });

      requestUrls.add(
        `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users?${searchParams.toString()}`,
      );
    };

    addSearchUrl({ search: normalizedQuery });
    // eslint-disable-next-line no-control-regex -- Control characters cannot be used in Keycloak attribute queries.
    if (!/[\\\u0000-\u001f]/.test(normalizedQuery)) {
      addSearchUrl({ q: this.buildAttributeQuery('identity-document', normalizedQuery) });
      addSearchUrl({ q: this.buildAttributeQuery('identityDocument', normalizedQuery) });
      addSearchUrl({ q: this.buildAttributeQuery('fullName', normalizedQuery) });
    }

    if (normalizedQuery.includes('@')) {
      addSearchUrl({ email: normalizedQuery });
      addSearchUrl({ email: normalizedQuery, exact: 'true' });
    }

    const responses = await Promise.allSettled(
      [...requestUrls].map(async (url) => {
        const response = await this.fetchWithTimeout(url, {
          headers: {
            Authorization: `Bearer ${adminToken}`,
          },
        });

        if (!response.ok) {
          const details = await this.readTokenError(response);

          this.logger.warn('Keycloak user search branch failed', {
            status: response.status,
            statusText: response.statusText,
            url,
            query: normalizedQuery,
            contentType: details.contentType,
            responseHeaders: details.headers,
          });

          throw new Error(`Failed to search users: ${response.status} ${response.statusText}`);
        }

        return this.readUserList(response);
      }),
    );

    const usersById = new Map<string, KeycloakUserData>();
    const successfulResponses = responses.filter((response) => response.status === 'fulfilled');
    if (successfulResponses.length === 0) {
      const failure = responses.find((response) => response.status === 'rejected');
      throw failure?.reason ?? new KeycloakConnectionException('Authentication service user search failed');
    }

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

  async searchUsersByAttribute(
    attributeName: string,
    attributeValue: string,
    options: { max?: number } = {},
  ): Promise<KeycloakUserData[]> {
    const normalizedAttributeName = attributeName.trim();
    const normalizedAttributeValue = attributeValue.trim();

    if (!normalizedAttributeName || !normalizedAttributeValue) {
      return [];
    }

    const max = this.getSearchLimit(options.max);
    const searchParams = new URLSearchParams({
      first: '0',
      max: String(max),
      briefRepresentation: 'false',
      q: this.buildAttributeQuery(normalizedAttributeName, normalizedAttributeValue),
    });
    const usersUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users?${searchParams.toString()}`;
    const adminToken = await this.getAdminToken();

    const response = await this.fetchWithTimeout(usersUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to search Keycloak users by attribute', {
        status: response.status,
        statusText: response.statusText,
        usersUrl,
        attributeName: normalizedAttributeName,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to search users by attribute: ${response.status} ${response.statusText}`);
    }

    return this.readUserList(response);
  }

  private async readUserList(response: Response): Promise<KeycloakUserData[]> {
    const users: unknown = await response.json();
    if (
      !Array.isArray(users) ||
      users.some((user: unknown) => {
        if (!user || typeof user !== 'object' || Array.isArray(user)) return true;
        if (!('id' in user) || typeof user.id !== 'string' || !user.id.trim()) return true;
        return 'email' in user && typeof user.email !== 'string';
      })
    ) {
      throw new KeycloakConnectionException('Authentication service returned invalid user search results');
    }
    return users as KeycloakUserData[];
  }

  private getSearchLimit(max = 10): number {
    if (!Number.isInteger(max) || max < 1) {
      throw new BadRequestException('O limite de resultados deve ser um número inteiro positivo.');
    }
    return Math.min(max, 50);
  }

  private async readUserData(response: Response, userId: string): Promise<KeycloakUserData> {
    const data: unknown = await response.json();
    if (!data || typeof data !== 'object' || Array.isArray(data) || !('id' in data) || data.id !== userId) {
      throw new KeycloakConnectionException('Authentication service returned invalid account data');
    }
    const user = data as KeycloakUserData;
    if (
      user.attributes &&
      (typeof user.attributes !== 'object' ||
        Array.isArray(user.attributes) ||
        Object.values(user.attributes).some(
          (values) => !Array.isArray(values) || values.some((value) => typeof value !== 'string'),
        ))
    ) {
      throw new KeycloakConnectionException('Authentication service returned invalid account attributes');
    }
    return user;
  }

  private buildAttributeQuery(name: string, value: string): string {
    // Keycloak's q parameter has its own grammar, independent of URL encoding.
    // Backslashes cannot be represented reliably by the 26.2 parser.
    // eslint-disable-next-line no-control-regex -- Reject control characters before building a Keycloak attribute query.
    if (!/^[a-zA-Z0-9_.-]+$/.test(name) || /[\\\u0000-\u001f]/.test(value)) {
      throw new BadRequestException('A busca por atributo contém caracteres inválidos.');
    }
    return `${name}:"${value.replace(/"/g, '\\"')}"`;
  }

  async getUserBasicInfo(userId: string): Promise<KeycloakUserData | null> {
    if (!userId) {
      throw new Error('Keycloak user ID is required');
    }

    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;

    this.logger.debug('Getting basic user info', { userId });

    const response = await this.fetchWithTimeout(userUrl, {
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${adminToken}`,
        'Cache-Control': 'no-cache, no-store',
      },
    });

    if (response.status !== 200) {
      if (response.status === 404) {
        this.logger.warn('User not found in Keycloak', { userId });
        return null;
      }

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get basic user info', {
        status: response.status,
        statusText: response.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to get basic user info: ${response.status} ${response.statusText}`);
    }

    const userData: unknown = await response.json();

    // Account status is meaningful only for the exact identity we requested.
    if (
      !userData ||
      typeof userData !== 'object' ||
      Array.isArray(userData) ||
      !('id' in userData) ||
      userData.id !== userId ||
      ('enabled' in userData && typeof userData.enabled !== 'boolean')
    ) {
      throw new KeycloakConnectionException('Authentication service returned invalid account data');
    }

    this.logger.debug('Basic user info retrieved', {
      id: userData.id,
    });

    return userData as KeycloakUserData;
  }

  async updateUser(userId: string, data: Partial<KeycloakUserData>): Promise<void> {
    await this.serializeUserUpdate(userId, () => this.saveUser(userId, data));
    await this.notifyUserUpdated(userId);
  }

  private async saveUser(userId: string, data: Partial<KeycloakUserData>): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;

    const currentResponse = await this.fetchWithTimeout(userUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!currentResponse.ok) {
      const details = await this.readTokenError(currentResponse);

      this.logger.error('Failed to get current user before update', {
        status: currentResponse.status,
        statusText: currentResponse.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(
        `Failed to get current user before update: ${currentResponse.status} ${currentResponse.statusText}`,
      );
    }

    const currentUser = await this.readUserData(currentResponse, userId);

    const updateResponse = await this.fetchWithTimeout(userUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...data,
        ...(data.attributes && {
          username: data.username ?? currentUser.username,
          email: data.email ?? currentUser.email,
          firstName: data.firstName ?? currentUser.firstName,
          lastName: data.lastName ?? currentUser.lastName,
          attributes: { ...currentUser.attributes, ...data.attributes },
        }),
      }),
    });

    if (!updateResponse.ok) {
      const details = await this.readTokenError(updateResponse);

      this.logger.error('Failed to update user', {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to update user: ${updateResponse.status} ${updateResponse.statusText}`);
    }
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.updateUser(userId, { enabled });
  }

  async getFederatedIdentities(userId: string): Promise<KeycloakFederatedIdentity[]> {
    const adminToken = await this.getAdminToken();
    const identitiesUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}/federated-identity`;

    const response = await this.fetchWithTimeout(identitiesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        return [];
      }

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get federated identities', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identitiesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to get federated identities: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as KeycloakFederatedIdentity[];
  }

  async addFederatedIdentity(userId: string, identity: KeycloakFederatedIdentity): Promise<void> {
    const adminToken = await this.getAdminToken();
    const identityUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}/federated-identity/${encodeURIComponent(
      identity.identityProvider,
    )}`;

    const response = await this.fetchWithTimeout(identityUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(identity),
    });

    if (response.status === 409) {
      const existingIdentities = await this.getFederatedIdentities(userId);
      if (
        existingIdentities.some(
          (existing) => existing.identityProvider === identity.identityProvider && existing.userId === identity.userId,
        )
      ) {
        return;
      }
      throw new ConflictException('Esta conta já possui outro vínculo com o provedor de identidade.');
    }

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to add federated identity', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identityProvider: identity.identityProvider,
        identityUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to add federated identity: ${response.status} ${response.statusText}`);
    }
  }

  async removeFederatedIdentity(userId: string, identityProvider: string): Promise<void> {
    const adminToken = await this.getAdminToken();
    const identityUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}/federated-identity/${encodeURIComponent(
      identityProvider,
    )}`;

    const response = await this.fetchWithTimeout(identityUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to remove federated identity', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identityProvider,
        identityUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to remove federated identity: ${response.status} ${response.statusText}`);
    }
  }

  async deleteUser(userId: string): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${encodeURIComponent(this.realm)}/users/${encodeURIComponent(userId)}`;

    this.logger.debug('Deleting user from Keycloak', { userId });

    const response = await this.fetchWithTimeout(userUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('User not found in Keycloak, may have been already deleted', { userId });
        await this.notifyUserUpdated(userId);
        return;
      }

      const details = await this.readTokenError(response);

      this.logger.error('Failed to delete user from Keycloak', {
        status: response.status,
        statusText: response.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error(`Failed to delete user from Keycloak: ${response.status} ${response.statusText}`);
    }

    await this.notifyUserUpdated(userId);
    this.logger.log('User successfully deleted from Keycloak', { userId });
  }
}
