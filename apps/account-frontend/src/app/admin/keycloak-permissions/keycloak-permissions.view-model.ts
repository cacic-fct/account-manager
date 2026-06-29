import {
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  PermissionGroupDefinition,
  PermissionGroupMembership,
  PermissionGroupRoleGrant,
} from '@cacic/shared-types';

export type PermissionClientGroup = {
  clientId: string;
  clientLabel: string;
  permissions: KeycloakPermissionDefinition[];
};

export function groupPermissionsByClient(
  catalog: readonly KeycloakPermissionDefinition[],
): PermissionClientGroup[] {
  const groups = new Map<string, PermissionClientGroup>();

  for (const permission of catalog) {
    const existing = groups.get(permission.clientId);
    if (existing) {
      existing.permissions.push(permission);
      continue;
    }

    groups.set(permission.clientId, {
      clientId: permission.clientId,
      clientLabel: permission.clientLabel,
      permissions: [permission],
    });
  }

  return [...groups.values()].map((group) => ({
    ...group,
    permissions: group.permissions.sort((left, right) =>
      left.label.localeCompare(right.label),
    ),
  }));
}

export function activeGroupPermissions(
  grants: readonly PermissionGroupRoleGrant[],
): Set<string> {
  return new Set(
    grants
      .filter((grant) => grant.status !== 'expired')
      .map((grant) => grant.permission),
  );
}

export function availableDirectPermissions(
  catalog: readonly KeycloakPermissionDefinition[],
  directGrants: readonly KeycloakPermissionGrant[],
): KeycloakPermissionDefinition[] {
  const granted = new Set(directGrants.map((grant) => grant.permission));
  return catalog.filter((permission) => !granted.has(permission.permission));
}

export function getPermissionLabel(
  catalog: readonly KeycloakPermissionDefinition[],
  permission: string,
): string {
  return (
    catalog.find((definition) => definition.permission === permission)?.label ??
    permission
  );
}

export function getPermissionClientLabel(
  catalog: readonly KeycloakPermissionDefinition[],
  permission: string,
): string {
  return (
    catalog.find((definition) => definition.permission === permission)
      ?.clientLabel ??
    permission.split(':')[0] ??
    permission
  );
}

export function getGroupLabel(
  groups: readonly PermissionGroupDefinition[],
  groupKey: string,
): string {
  return groups.find((group) => group.key === groupKey)?.label ?? groupKey;
}

export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    active: 'Ativa',
    scheduled: 'Agendada',
    expired: 'Expirada',
  };

  return labels[status] ?? status;
}

export function formatValidity(item: {
  validFrom?: string | null;
  validUntil?: string | null;
}): string {
  const start = item.validFrom ? formatDate(item.validFrom) : 'agora';
  const end = item.validUntil ? formatDate(item.validUntil) : 'sem fim';
  return `${start} até ${end}`;
}

export function formatMembership(
  membership: PermissionGroupMembership,
): string {
  const start = formatDate(membership.validFrom);
  const end = membership.validUntil
    ? formatDate(membership.validUntil)
    : 'sem fim definido';
  return `${start} até ${end}`;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('pt-BR', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(value));
}
