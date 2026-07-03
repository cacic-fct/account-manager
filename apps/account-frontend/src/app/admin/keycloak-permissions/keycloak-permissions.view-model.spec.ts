import {
  mockDirectKeycloakPermissionGrant,
  mockKeycloakPermissionCatalog,
  mockPermissionGroupCatalog,
  mockPermissionGroupRoleGrants,
} from '../../../storybook/mocks/component-mocks';
import {
  activeGroupPermissions,
  availableDirectPermissions,
  getGroupLabel,
  getPermissionClientLabel,
  getPermissionLabel,
  getStatusLabel,
  groupPermissionsByClient,
} from './keycloak-permissions.view-model';

describe('keycloak permissions view model helpers', () => {
  it('groups catalog permissions by client and sorts each client by label', () => {
    const grouped = groupPermissionsByClient([
      mockKeycloakPermissionCatalog[1],
      mockKeycloakPermissionCatalog[0],
    ]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0].permissions.map((permission) => permission.label)).toEqual(
      [...grouped[0].permissions.map((permission) => permission.label)].sort(),
    );
  });

  it('returns only active group permissions for group form state', () => {
    const permissions = activeGroupPermissions([
      ...mockPermissionGroupRoleGrants,
      {
        ...mockPermissionGroupRoleGrants[0],
        id: 'expired-grant',
        permission: 'cacic-account-manager:expired',
        status: 'expired',
      },
    ]);

    expect(permissions.has('cacic-account-manager:expired')).toBe(false);
    expect(permissions.has(mockPermissionGroupRoleGrants[0].permission)).toBe(
      true,
    );
  });

  it('filters direct grant options and resolves display labels', () => {
    const available = availableDirectPermissions(mockKeycloakPermissionCatalog, [
      mockDirectKeycloakPermissionGrant,
    ]);

    expect(
      available.some(
        (permission) =>
          permission.permission === mockDirectKeycloakPermissionGrant.permission,
      ),
    ).toBe(false);
    expect(
      getPermissionLabel(
        mockKeycloakPermissionCatalog,
        mockKeycloakPermissionCatalog[0].permission,
      ),
    ).toBe(mockKeycloakPermissionCatalog[0].label);
    expect(
      getPermissionClientLabel(
        mockKeycloakPermissionCatalog,
        mockKeycloakPermissionCatalog[0].permission,
      ),
    ).toBe(mockKeycloakPermissionCatalog[0].clientLabel);
  });

  it('falls back when catalog or group labels are unknown', () => {
    expect(getPermissionLabel([], 'unknown:role')).toBe('unknown:role');
    expect(getPermissionClientLabel([], 'unknown:role')).toBe('unknown');
    expect(getGroupLabel(mockPermissionGroupCatalog, 'UNKNOWN')).toBe('UNKNOWN');
    expect(getStatusLabel('scheduled')).toBe('Agendada');
    expect(getStatusLabel('custom')).toBe('custom');
  });
});
