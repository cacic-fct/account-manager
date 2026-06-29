import { KeycloakUserOperations } from './keycloak-user.operations';

export abstract class KeycloakRoleGroupOperations extends KeycloakUserOperations {
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get user groups', {
        status: response.status,
        statusText: response.statusText,
        userId,
        userGroupsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
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
   * Get only direct role assignments for a user, not inherited from groups.
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

    this.logger.debug('Getting user client roles including inherited', {
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
        userRolesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to get user client roles: ${response.status} ${response.statusText}`,
      );
    }

    const roles = (await response.json()) as Array<{ name: string }>;

    this.logger.debug('User client roles retrieved including inherited', {
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

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get direct user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
        userRolesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
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
      const details = await this.readTokenError(response);

      this.logger.error('Failed to assign user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
        roleNames,
        roleMappingsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

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
      const details = await this.readTokenError(response);

      this.logger.error('Failed to remove user client roles', {
        status: response.status,
        statusText: response.statusText,
        userId,
        clientId,
        roleNames,
        roleMappingsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to remove user client roles: ${response.status} ${response.statusText}`,
      );
    }
  }

  async addUserToGroupPath(userId: string, groupPath: string): Promise<void> {
    const group = await this.getGroupByPath(groupPath);
    await this.addUserToGroupId(userId, group.id, groupPath);
  }

  async addUserToGroupId(
    userId: string,
    groupId: string,
    groupLabel = groupId,
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const groupUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`;

    const response = await fetch(groupUrl, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to add user to Keycloak group', {
        status: response.status,
        statusText: response.statusText,
        userId,
        groupPath: groupLabel,
        groupId,
        groupUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to add user to Keycloak group ${groupLabel}: ${response.status} ${response.statusText}`,
      );
    }
  }

  async removeUserFromGroupPath(
    userId: string,
    groupPath: string,
  ): Promise<void> {
    const group = await this.getGroupByPath(groupPath);
    await this.removeUserFromGroupId(userId, group.id, groupPath);
  }

  async removeUserFromGroupId(
    userId: string,
    groupId: string,
    groupLabel = groupId,
  ): Promise<void> {
    const adminToken = await this.getAdminToken();
    const groupUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/users/${userId}/groups/${groupId}`;

    const response = await fetch(groupUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok && response.status !== 404) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to remove user from Keycloak group', {
        status: response.status,
        statusText: response.statusText,
        userId,
        groupPath: groupLabel,
        groupId,
        groupUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to remove user from Keycloak group ${groupLabel}: ${response.status} ${response.statusText}`,
      );
    }
  }

  async getGroupClientRoles(
    groupId: string,
    clientId = this.clientId,
  ): Promise<string[]> {
    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const rolesUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/groups/${groupId}/role-mappings/clients/${clientUuid}/composite`;

    const response = await fetch(rolesUrl, {
      headers: {
        Authorization: `Bearer ${adminToken}`,
      },
    });

    if (!response.ok) {
      if (response.status === 404) {
        this.logger.warn('Group not found when getting client roles', {
          groupId,
          clientId,
        });
        return [];
      }

      const details = await this.readTokenError(response);

      this.logger.error('Failed to get group client roles', {
        status: response.status,
        statusText: response.statusText,
        groupId,
        clientId,
        rolesUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to get group client roles: ${response.status} ${response.statusText}`,
      );
    }

    const roles = (await response.json()) as Array<{ name: string }>;
    return roles.map((role) => role.name);
  }

  async addGroupClientRoles(
    groupId: string,
    roleNames: readonly string[],
    clientId = this.clientId,
  ): Promise<void> {
    const roles = await this.getClientRolesByName(clientId, roleNames);

    if (roles.length === 0) {
      return;
    }

    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const roleMappingsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/groups/${groupId}/role-mappings/clients/${clientUuid}`;

    const response = await fetch(roleMappingsUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(roles),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to assign group client roles', {
        status: response.status,
        statusText: response.statusText,
        groupId,
        clientId,
        roleNames,
        roleMappingsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to assign group client roles: ${response.status} ${response.statusText}`,
      );
    }
  }

  async removeGroupClientRoles(
    groupId: string,
    roleNames: readonly string[],
    clientId = this.clientId,
  ): Promise<void> {
    const roles = await this.getClientRolesByName(clientId, roleNames);

    if (roles.length === 0) {
      return;
    }

    const adminToken = await this.getAdminToken();
    const clientUuid = await this.getClientUuid(clientId, adminToken);
    const roleMappingsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/groups/${groupId}/role-mappings/clients/${clientUuid}`;

    const response = await fetch(roleMappingsUrl, {
      method: 'DELETE',
      headers: {
        Authorization: `Bearer ${adminToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(roles),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.error('Failed to remove group client roles', {
        status: response.status,
        statusText: response.statusText,
        groupId,
        clientId,
        roleNames,
        roleMappingsUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
        bodyPreview: details.bodyPreview,
      });

      throw new Error(
        `Failed to remove group client roles: ${response.status} ${response.statusText}`,
      );
    }
  }
}
