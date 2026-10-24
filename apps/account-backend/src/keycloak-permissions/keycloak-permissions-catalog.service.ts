import {
  KEYCLOAK_PERMISSION_CLIENTS,
  PERMISSION_GROUP_CATALOG,
  PermissionGroupDefinition,
  buildKeycloakPermissionId,
  KeycloakPermissionDefinition,
  KeycloakPermissionLiveAccess,
  parseKeycloakPermissionId,
} from '@cacic/shared-types';
import { BadRequestException, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { KeycloakService } from '../auth/services/keycloak.service';
import { fallbackAccountManagerDefinitions, getRoleLabel, isDbManagedRole } from './keycloak-permissions.helpers';

interface KeycloakPermissionCatalogSnapshot {
  definitions: KeycloakPermissionDefinition[];
  unavailableClientIds: string[];
  unavailableClientIdSet: Set<string>;
  knownPermissions: Set<string>;
}

@Injectable()
export class KeycloakPermissionsCatalogService {
  private readonly logger = new Logger(KeycloakPermissionsCatalogService.name);
  private catalogPromise?: Promise<KeycloakPermissionCatalogSnapshot>;

  constructor(private readonly keycloakService: KeycloakService) {}

  async listCatalog(): Promise<KeycloakPermissionDefinition[]> {
    return (await this.loadCatalog()).definitions;
  }

  private async loadCatalog(): Promise<KeycloakPermissionCatalogSnapshot> {
    const catalogPromise = (this.catalogPromise ??= this.fetchCatalog());
    try {
      return await catalogPromise;
    } finally {
      // Coalesce concurrent reads without retaining stale roles between requests.
      if (this.catalogPromise === catalogPromise) {
        this.catalogPromise = undefined;
      }
    }
  }

  private async fetchCatalog(): Promise<KeycloakPermissionCatalogSnapshot> {
    const results = await Promise.all(
      KEYCLOAK_PERMISSION_CLIENTS.map(async (client) => {
        try {
          const roles = await this.keycloakService.listClientRoles(client.clientId);
          const definitions = roles
            .filter((role) => isDbManagedRole(role.name))
            .map((role) => ({
              permission: buildKeycloakPermissionId(client.clientId, role.name),
              clientId: client.clientId,
              clientLabel: client.label,
              roleName: role.name,
              label: getRoleLabel(role.name),
              description: role.description,
              composite: role.composite,
              source: 'keycloak' as const,
            }));

          return { definitions, unavailableClientId: undefined };
        } catch (error) {
          this.logger.warn(`Failed to load Keycloak roles for ${client.clientId}`, error);

          return {
            definitions: client.clientId === 'cacic-account-manager' ? fallbackAccountManagerDefinitions() : [],
            unavailableClientId: client.clientId,
          };
        }
      }),
    );

    const definitions = results
      .flatMap((result) => result.definitions)
      .sort((left, right) => `${left.clientLabel}:${left.label}`.localeCompare(`${right.clientLabel}:${right.label}`));
    const unavailableClientIds: string[] = [];
    for (const result of results) {
      if (result.unavailableClientId) {
        unavailableClientIds.push(result.unavailableClientId);
      }
    }

    return {
      definitions,
      unavailableClientIds,
      unavailableClientIdSet: new Set(unavailableClientIds),
      knownPermissions: new Set(definitions.map((definition) => definition.permission)),
    };
  }

  listPermissionGroups(): readonly PermissionGroupDefinition[] {
    return PERMISSION_GROUP_CATALOG;
  }

  async getUserLiveAccess(userId: string): Promise<KeycloakPermissionLiveAccess> {
    try {
      const [groups, roleLists] = await Promise.all([
        this.keycloakService.getUserGroupMemberships(userId),
        Promise.all(
          KEYCLOAK_PERMISSION_CLIENTS.map(async (client) => {
            const roles = await this.keycloakService.getUserClientRoles(userId, client.clientId);
            return roles.filter(isDbManagedRole).map((role) => buildKeycloakPermissionId(client.clientId, role));
          }),
        ),
      ]);
      const groupIds = new Set(groups.map((group) => group.id));

      return {
        permissions: [...new Set(roleLists.flat())].sort(),
        groupKeys: PERMISSION_GROUP_CATALOG.filter((group) => groupIds.has(group.keycloakGroupId)).map(
          (group) => group.key,
        ),
      };
    } catch (error) {
      this.logger.error('Failed to read current permissions for an account', { userId, error });
      throw new ServiceUnavailableException(
        'Não foi possível consultar as permissões atuais da conta. Tente novamente em alguns minutos.',
      );
    }
  }

  async listKeycloakGroupPermissions(
    group: PermissionGroupDefinition,
    options: { allowPartial?: boolean } = {},
  ): Promise<KeycloakPermissionDefinition[]> {
    return (await this.loadKeycloakGroupPermissions(group, options)).permissions;
  }

  async listKeycloakGroupPermissionsWithAvailability(
    group: PermissionGroupDefinition,
    options: { allowPartial?: boolean } = {},
  ): Promise<{
    permissions: KeycloakPermissionDefinition[];
    unavailableClientIds: string[];
  }> {
    return this.loadKeycloakGroupPermissions(group, options);
  }

  private async loadKeycloakGroupPermissions(
    group: PermissionGroupDefinition,
    options: { allowPartial?: boolean },
  ): Promise<{
    permissions: KeycloakPermissionDefinition[];
    unavailableClientIds: string[];
  }> {
    const results = await Promise.all(
      KEYCLOAK_PERMISSION_CLIENTS.map(async (client) => {
        try {
          return {
            client,
            roles: await this.keycloakService.getGroupClientRoles(group.keycloakGroupId, client.clientId),
            error: undefined,
          };
        } catch (error) {
          return {
            client,
            roles: [],
            error: error instanceof Error ? error : new Error(String(error)),
          };
        }
      }),
    );
    const permissions: KeycloakPermissionDefinition[] = [];
    const unavailableClientIds: string[] = [];
    let firstError: Error | undefined;

    results.forEach((result) => {
      if (result.error) {
        this.logger.warn(
          `Failed to load Keycloak roles for group ${group.key} and client ${result.client.clientId}`,
          result.error,
        );
        unavailableClientIds.push(result.client.clientId);
        firstError ??= result.error;
        return;
      }

      permissions.push(
        ...result.roles
          .filter((roleName) => isDbManagedRole(roleName))
          .map((roleName) => ({
            permission: buildKeycloakPermissionId(result.client.clientId, roleName),
            clientId: result.client.clientId,
            clientLabel: result.client.label,
            roleName,
            label: getRoleLabel(roleName),
            source: 'keycloak' as const,
          })),
      );
    });

    if (!options.allowPartial && firstError) {
      throw firstError;
    }

    return { permissions, unavailableClientIds };
  }

  async assertPermissionsKnown(permissions: readonly string[]): Promise<void> {
    const catalog = await this.loadCatalog();
    const requestedUnavailableClientIds = [
      ...new Set(
        permissions
          .map((permission) => parseKeycloakPermissionId(permission)?.clientId)
          .filter((clientId): clientId is string => !!clientId && catalog.unavailableClientIdSet.has(clientId)),
      ),
    ];
    if (requestedUnavailableClientIds.length > 0) {
      throw new ServiceUnavailableException(
        'Não foi possível consultar algumas permissões agora. Atualize a lista e tente novamente em alguns minutos.',
      );
    }

    const unknown = permissions.filter((permission) => !catalog.knownPermissions.has(permission));

    if (unknown.length > 0) {
      throw new BadRequestException(`Permissão inválida: ${unknown.join(', ')}.`);
    }
  }
}
