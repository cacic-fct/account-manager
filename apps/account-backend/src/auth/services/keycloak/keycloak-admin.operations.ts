import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';
import { KeycloakClientRoleNotFoundException } from '../../exceptions/keycloak-client-role-not-found.exception';
import { KeycloakClient, KeycloakGroup, KeycloakRole, TokenResponse } from './keycloak.types';
import { KeycloakLoginOperations } from './keycloak-login.operations';

export abstract class KeycloakAdminOperations extends KeycloakLoginOperations {
  async getAdminToken(): Promise<string> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.adminClientId,
      client_secret: this.getAdminClientSecret(),
    });

    try {
      this.logger.debug('Getting Keycloak admin token', {
        tokenUrl,
        clientId: this.adminClientId,
        grantType: 'client_credentials',
      });

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
          tokenUrl,
          clientId: this.adminClientId,
          error: details.error,
          errorDescription: details.errorDescription,
          contentType: details.contentType,
          responseHeaders: details.headers,
          bodyPreview: details.bodyPreview,
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

  protected async getClientRolesByName(clientId: string, roleNames: readonly string[]): Promise<KeycloakRole[]> {
    const normalizedRoleNames = [...new Set(roleNames.map((role) => role.trim()))].filter((role) => role.length > 0);

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
            throw new KeycloakClientRoleNotFoundException(clientId, roleName);
          }

          const details = await this.readTokenError(response);

          this.logger.error('Failed to get Keycloak client role', {
            status: response.status,
            statusText: response.statusText,
            clientId,
            roleName,
            roleUrl,
            contentType: details.contentType,
            responseHeaders: details.headers,
            bodyPreview: details.bodyPreview,
          });

          throw new Error(
            `Failed to get client role ${clientId}:${roleName}: ${response.status} ${response.statusText}`,
          );
        }

        return (await response.json()) as KeycloakRole;
      }),
    );

    return roles;
  }

  async listClientRoles(clientId: string): Promise<KeycloakRole[]> {
    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const rolesUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/clients/${clientUuid}/roles?briefRepresentation=false`;

    const response = await fetch(rolesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to list Keycloak client roles', {
        status: response.status,
        statusText: response.statusText,
        clientId,
        rolesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to list client roles ${clientId}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as KeycloakRole[];
  }

  protected async getClientUuid(clientId: string, adminToken?: string): Promise<string> {
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
      const details = await this.readTokenError(response);

      this.logger.error('Failed to find Keycloak client', {
        status: response.status,
        statusText: response.statusText,
        clientId: normalizedClientId,
        clientsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to find Keycloak client ${normalizedClientId}: ${response.status} ${response.statusText}`,
      );
    }

    const clients = (await response.json()) as KeycloakClient[];
    const client = clients.find((candidate) => candidate.clientId === normalizedClientId);

    if (!client) {
      throw new Error(`Keycloak client ${normalizedClientId} was not found`);
    }

    this.clientUuidCache.set(normalizedClientId, client.id);
    return client.id;
  }

  protected async getGroupByPath(groupPath: string): Promise<KeycloakGroup> {
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get Keycloak group by path', {
        status: response.status,
        statusText: response.statusText,
        groupPath,
        normalizedPath,
        groupUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(`Failed to get Keycloak group ${groupPath}: ${response.status} ${response.statusText}`);
    }

    return (await response.json()) as KeycloakGroup;
  }
}
