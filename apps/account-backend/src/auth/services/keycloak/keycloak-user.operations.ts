import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';
import { KeycloakErrorResponse, KeycloakFederatedIdentity, KeycloakUserData } from './keycloak.types';
import { KeycloakAdminOperations } from './keycloak-admin.operations';

export abstract class KeycloakUserOperations extends KeycloakAdminOperations {
  async updateUserAttributes(
    userId: string,
    attributes: Record<string, string | string[]>,
    options: { skipValidation?: boolean } = {},
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    const getUserResponse = await fetch(userUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to get current user data');
    }

    const currentUser = (await getUserResponse.json()) as KeycloakUserData;

    const requiredAttributes = ['identity-document', 'phone', 'fullName'];

    const updatedAttributes = {
      ...currentUser.attributes,
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
        responseHeaders: this.readResponseDebugHeaders(updateResponse),
        error: errorText,
      });

      try {
        const errorData = JSON.parse(errorText) as KeycloakErrorResponse;

        if (errorData.errors && Array.isArray(errorData.errors)) {
          const validationErrors = errorData.errors.map((err) => `${err.field}: ${err.errorMessage}`).join(', ');

          throw new Error(`Validation failed: ${validationErrors}`);
        }
      } catch {
        // If parsing fails, use original error below.
      }

      throw new Error(`Failed to update user attributes: ${updateResponse.status} ${updateResponse.statusText}`);
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
        const details = await this.readTokenError(response);

        this.logger.error('Failed to get user attributes', {
          status: response.status,
          statusText: response.statusText,
          userId,
          url: userUrl,
          contentType: details.contentType,
          responseHeaders: details.headers,
          bodyPreview: details.bodyPreview,
        });

        if (response.status === 404) {
          throw new Error(`User with ID ${userId} not found in Keycloak`);
        }

        throw new Error(`Failed to get user attributes: ${response.status} ${response.statusText}`);
      }

      const userData = (await response.json()) as KeycloakUserData;

      this.logger.debug('User attributes retrieved', {
        id: userData.id,
        email: userData.email,
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
    const adminToken = await this.getAdminToken();
    const usersUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users?email=${encodeURIComponent(email)}&exact=true`;

    const response = await fetch(usersUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to find user by email');
    }

    const users = (await response.json()) as KeycloakUserData[];
    return users.length > 0 ? users[0] : null;
  }

  async searchUsers(query: string, options: { max?: number } = {}): Promise<KeycloakUserData[]> {
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

      requestUrls.add(`${this.keycloakUrl}/admin/realms/${this.realm}/users?${searchParams.toString()}`);
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
          const details = await this.readTokenError(response);

          this.logger.warn('Keycloak user search branch failed', {
            status: response.status,
            statusText: response.statusText,
            url,
            query: normalizedQuery,
            contentType: details.contentType,
            responseHeaders: details.headers,
            bodyPreview: details.bodyPreview,
          });

          throw new Error(`Failed to search users: ${response.status} ${response.statusText}`);
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

    const adminToken = await this.getAdminToken();
    const max = Math.min(Math.max(options.max ?? 10, 1), 50);
    const searchParams = new URLSearchParams({
      first: '0',
      max: String(max),
      briefRepresentation: 'false',
      q: `${normalizedAttributeName}:${normalizedAttributeValue}`,
    });
    const usersUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users?${searchParams.toString()}`;

    const response = await fetch(usersUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to search users by attribute: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as KeycloakUserData[];
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get basic user info', {
        status: response.status,
        statusText: response.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to get basic user info: ${response.status} ${response.statusText}`);
    }

    const userData = (await response.json()) as KeycloakUserData;

    this.logger.debug('Basic user info retrieved', {
      id: userData.id,
      email: userData.email,
    });

    return userData;
  }

  async updateUser(userId: string, data: Partial<KeycloakUserData>): Promise<void> {
    const adminToken = await this.getAdminToken();
    const userUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}`;

    const currentResponse = await fetch(userUrl, {
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
        bodyPreview: details.bodyPreview,
      });

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
      const details = await this.readTokenError(updateResponse);

      this.logger.error('Failed to update user', {
        status: updateResponse.status,
        statusText: updateResponse.statusText,
        userId,
        userUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to update user: ${updateResponse.status} ${updateResponse.statusText}`);
    }
  }

  async setUserEnabled(userId: string, enabled: boolean): Promise<void> {
    await this.updateUser(userId, { enabled });
  }

  async getFederatedIdentities(userId: string): Promise<KeycloakFederatedIdentity[]> {
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get federated identities', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identitiesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to get federated identities: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as KeycloakFederatedIdentity[];
  }

  async addFederatedIdentity(userId: string, identity: KeycloakFederatedIdentity): Promise<void> {
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
      const details = await this.readTokenError(response);

      this.logger.error('Failed to add federated identity', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identityProvider: identity.identityProvider,
        identityUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to add federated identity: ${response.status} ${response.statusText}`);
    }
  }

  async removeFederatedIdentity(userId: string, identityProvider: string): Promise<void> {
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
      const details = await this.readTokenError(response);

      this.logger.error('Failed to remove federated identity', {
        status: response.status,
        statusText: response.statusText,
        userId,
        identityProvider,
        identityUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to remove federated identity: ${response.status} ${response.statusText}`);
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
        this.logger.warn('User not found in Keycloak, may have been already deleted', { userId });
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to delete user from Keycloak: ${response.status} ${response.statusText}`);
    }

    this.logger.log('User successfully deleted from Keycloak', { userId });
  }
}
