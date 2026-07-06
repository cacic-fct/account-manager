import { KeycloakApplication } from '../../interfaces/auth.interface';
import { KeycloakRoleGroupOperations } from './keycloak-role-group.operations';

export abstract class KeycloakApplicationOperations extends KeycloakRoleGroupOperations {
  async getUserApplications(userId: string): Promise<KeycloakApplication[]> {
    try {
      const adminToken = await this.getAdminToken();
      const clientsUrl = `${this.keycloakUrl}/admin/realms/${this.realm}/clients`;

      this.logger.debug('Getting applications for user', { userId });

      const response = await fetch(clientsUrl, {
        headers: {
          Authorization: `Bearer ${adminToken}`,
        },
      });

      if (!response.ok) {
        const details = await this.readTokenError(response);

        this.logger.error('Failed to get applications', {
          status: response.status,
          statusText: response.statusText,
          clientsUrl,
          userId,
          contentType: details.contentType,
          responseHeaders: details.headers,
          bodyPreview: details.bodyPreview,
        });

        throw new Error(`Failed to get applications: ${response.status} ${response.statusText}`);
      }

      const clients = (await response.json()) as KeycloakApplication[];

      const applications = clients.filter((client) => {
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
          (client.publicClient || client.baseUrl)
        );
      });

      this.logger.debug('Applications found for user', {
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
}
