import {
  KEYCLOAK_PERMISSION_CLIENTS,
  PERMISSION_GROUP_CATALOG,
  PermissionGroupDefinition,
  buildKeycloakPermissionId,
  KeycloakPermissionDefinition,
  parseKeycloakPermissionId,
} from '@cacic/shared-types';
import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KeycloakService } from '../auth/services/keycloak.service';
import {
  fallbackAccountManagerDefinitions,
  getRoleLabel,
  isHiddenRole,
} from './keycloak-permissions.helpers';

@Injectable()
export class KeycloakPermissionsCatalogService {
  private readonly logger = new Logger(KeycloakPermissionsCatalogService.name);

  constructor(private readonly keycloakService: KeycloakService) {}

  async listCatalog(): Promise<KeycloakPermissionDefinition[]> {
    return (await this.loadCatalog()).definitions;
  }

  private async loadCatalog(): Promise<{
    definitions: KeycloakPermissionDefinition[];
    unavailableClientIds: string[];
  }> {
    const definitions: KeycloakPermissionDefinition[] = [];
    const unavailableClientIds: string[] = [];

    for (const client of KEYCLOAK_PERMISSION_CLIENTS) {
      try {
        const roles = await this.keycloakService.listClientRoles(
          client.clientId,
        );

        definitions.push(
          ...roles
            .filter((role) => !isHiddenRole(role.name))
            .map((role) => ({
              permission: buildKeycloakPermissionId(client.clientId, role.name),
              clientId: client.clientId,
              clientLabel: client.label,
              roleName: role.name,
              label: getRoleLabel(role.name),
              description: role.description,
              composite: role.composite,
              source: 'keycloak' as const,
            })),
        );

        if (client.clientId === 'cacic-account-manager') {
          const knownPermissions = new Set(
            definitions
              .filter(
                (definition) => definition.clientId === 'cacic-account-manager',
              )
              .map((definition) => definition.permission),
          );

          definitions.push(
            ...fallbackAccountManagerDefinitions().filter(
              (definition) => !knownPermissions.has(definition.permission),
            ),
          );
        }
      } catch (error) {
        this.logger.warn(
          `Failed to load Keycloak roles for ${client.clientId}`,
          error,
        );

        if (client.clientId === 'cacic-account-manager') {
          definitions.push(...fallbackAccountManagerDefinitions());
        } else {
          unavailableClientIds.push(client.clientId);
        }
      }
    }

    return {
      definitions: definitions.sort((left, right) =>
        `${left.clientLabel}:${left.label}`.localeCompare(
          `${right.clientLabel}:${right.label}`,
        ),
      ),
      unavailableClientIds,
    };
  }

  listPermissionGroups(): readonly PermissionGroupDefinition[] {
    return PERMISSION_GROUP_CATALOG;
  }

  async listKeycloakGroupPermissions(
    group: PermissionGroupDefinition,
    options: { allowPartial?: boolean } = {},
  ): Promise<KeycloakPermissionDefinition[]> {
    return (await this.loadKeycloakGroupPermissions(group, options))
      .permissions;
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
    const permissions: KeycloakPermissionDefinition[] = [];
    const unavailableClientIds: string[] = [];

    for (const client of KEYCLOAK_PERMISSION_CLIENTS) {
      try {
        const roles = await this.keycloakService.getGroupClientRoles(
          group.keycloakGroupId,
          client.clientId,
        );

        permissions.push(
          ...roles
            .filter((roleName) => !isHiddenRole(roleName))
            .map((roleName) => ({
              permission: buildKeycloakPermissionId(client.clientId, roleName),
              clientId: client.clientId,
              clientLabel: client.label,
              roleName,
              label: getRoleLabel(roleName),
              source: 'keycloak' as const,
            })),
        );
      } catch (error) {
        this.logger.warn(
          `Failed to load Keycloak roles for group ${group.key} and client ${client.clientId}`,
          error,
        );
        unavailableClientIds.push(client.clientId);
        if (options.allowPartial) {
          continue;
        }

        throw error;
      }
    }

    return { permissions, unavailableClientIds };
  }

  async assertPermissionsKnown(permissions: readonly string[]): Promise<void> {
    const catalog = await this.loadCatalog();
    const unavailableClientIds = new Set(catalog.unavailableClientIds);
    const requestedUnavailableClientIds = [
      ...new Set(
        permissions
          .map((permission) => parseKeycloakPermissionId(permission)?.clientId)
          .filter(
            (clientId): clientId is string =>
              !!clientId && unavailableClientIds.has(clientId),
          ),
      ),
    ];
    if (requestedUnavailableClientIds.length > 0) {
      throw new ServiceUnavailableException(
        `Catálogo de permissões indisponível para: ${requestedUnavailableClientIds.join(', ')}.`,
      );
    }

    const knownPermissions = new Set(
      catalog.definitions.map((definition) => definition.permission),
    );
    const unknown = permissions.filter(
      (permission) => !knownPermissions.has(permission),
    );

    if (unknown.length > 0) {
      throw new BadRequestException(
        `Permissão inválida: ${unknown.join(', ')}.`,
      );
    }
  }
}
