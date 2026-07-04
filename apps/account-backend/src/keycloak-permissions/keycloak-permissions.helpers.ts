import {
  ACCOUNT_MANAGER_ASSIGNABLE_ROLE_CATALOG,
  HIDDEN_KEYCLOAK_ROLE_NAMES,
  KEYCLOAK_PERMISSION_CLIENTS,
  PERMISSION_GROUP_CATALOG,
  PERMISSION_GROUP_SET,
  PermissionGroupDefinition,
  PermissionGroupKey,
  buildKeycloakPermissionId,
  parseKeycloakPermissionId,
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantStatus,
  KeycloakPermissionUser,
  PermissionGroupMembership,
  PermissionGroupMembershipStatus,
  PermissionGroupRoleGrant,
} from '@cacic/shared-types';
import { BadRequestException } from '@nestjs/common';
import { KeycloakUserData } from '../auth/services/keycloak.service';
import {
  MANAGED_KEYCLOAK_CLIENT_IDS,
  type GrantRecord,
  type GroupRoleGrantRecord,
  type MembershipRecord,
  type NormalizedMandateWindow,
  type NormalizedValidityWindow,
} from './keycloak-permissions.records';

export function normalizePermission(permission: string): string {
  const normalizedPermission = permission.trim();
  const parsedPermission = parseKeycloakPermissionId(normalizedPermission);
  if (!parsedPermission) {
    throw new BadRequestException(`Permissão inválida: ${permission}.`);
  }

  if (!MANAGED_KEYCLOAK_CLIENT_IDS.some((clientId) => clientId === parsedPermission.clientId)) {
    throw new BadRequestException(`Cliente Keycloak inválido: ${parsedPermission.clientId}.`);
  }

  if (isHiddenRole(parsedPermission.roleName)) {
    throw new BadRequestException(`Permissão inválida: ${permission}.`);
  }

  return buildKeycloakPermissionId(parsedPermission.clientId, parsedPermission.roleName);
}

export function normalizePermissionList(permissions: readonly string[]): string[] {
  return [...new Set(permissions.map((permission) => normalizePermission(permission)))];
}

export function normalizePermissionGroupKey(groupKey: string): PermissionGroupKey {
  const normalizedGroupKey = groupKey.trim().toUpperCase();
  if (!PERMISSION_GROUP_SET.has(normalizedGroupKey as PermissionGroupKey)) {
    throw new BadRequestException(`Grupo inválido: ${groupKey}.`);
  }

  return normalizedGroupKey as PermissionGroupKey;
}

export function getPermissionGroupDefinition(groupKey: PermissionGroupKey): PermissionGroupDefinition {
  const definition = PERMISSION_GROUP_CATALOG.find((candidate) => candidate.key === groupKey);
  if (!definition) {
    throw new BadRequestException(`Grupo inválido: ${groupKey}.`);
  }

  return definition;
}

export function parsePermissionOrThrow(permission: string): {
  clientId: string;
  roleName: string;
} {
  const parsedPermission = parseKeycloakPermissionId(permission);
  if (!parsedPermission) {
    throw new BadRequestException(`Permissão inválida: ${permission}.`);
  }

  return parsedPermission;
}

export function normalizeValidityWindow(
  validFrom: string | Date | null | undefined,
  validUntil: string | Date | null | undefined,
): NormalizedValidityWindow {
  const normalizedValidFrom = normalizeOptionalDate(validFrom, 'início da validade');
  const normalizedValidUntil = normalizeOptionalDate(validUntil, 'fim da validade');

  if (normalizedValidFrom && normalizedValidUntil && normalizedValidUntil.getTime() <= normalizedValidFrom.getTime()) {
    throw new BadRequestException('O fim da validade precisa ser posterior ao início.');
  }

  return {
    validFrom: normalizedValidFrom,
    validUntil: normalizedValidUntil,
  };
}

export function normalizeMandateWindow(validFrom: string, validUntil?: string | null): NormalizedMandateWindow {
  const mandateStart = normalizeRequiredDate(validFrom, 'início do vínculo');
  const mandateEnd = normalizeOptionalDate(validUntil, 'fim do vínculo');

  if (mandateEnd && mandateEnd.getTime() <= mandateStart.getTime()) {
    throw new BadRequestException('O fim do vínculo precisa ser posterior ao início.');
  }

  return { mandateStart, mandateEnd };
}

export function isGrantActive(grant: GrantRecord, now: Date): boolean {
  return (
    (!grant.validFrom || grant.validFrom.getTime() <= now.getTime()) &&
    (!grant.validUntil || grant.validUntil.getTime() > now.getTime())
  );
}

export function isGrantExpired(grant: GrantRecord, now: Date): boolean {
  return !!grant.validUntil && grant.validUntil.getTime() <= now.getTime();
}

export function isGroupRoleGrantActive(grant: GroupRoleGrantRecord, now: Date): boolean {
  return (
    (!grant.validFrom || grant.validFrom.getTime() <= now.getTime()) &&
    (!grant.validUntil || grant.validUntil.getTime() > now.getTime())
  );
}

export function isGroupRoleGrantExpired(grant: GroupRoleGrantRecord, now: Date): boolean {
  return !!grant.validUntil && grant.validUntil.getTime() <= now.getTime();
}

export function isMembershipActive(membership: MembershipRecord, now: Date): boolean {
  return (
    membership.mandateStart.getTime() <= now.getTime() &&
    (!membership.mandateEnd || membership.mandateEnd.getTime() > now.getTime())
  );
}

export function isMembershipExpired(membership: MembershipRecord, now: Date): boolean {
  return !!membership.mandateEnd && membership.mandateEnd.getTime() <= now.getTime();
}

export function hasSameValidityWindow(
  grant: Pick<GrantRecord, 'validFrom' | 'validUntil'>,
  validity: NormalizedValidityWindow,
): boolean {
  return sameInstant(grant.validFrom, validity.validFrom) && sameInstant(grant.validUntil, validity.validUntil);
}

export function mapKeycloakUser(user: KeycloakUserData): KeycloakPermissionUser {
  const fullName =
    user.attributes?.['fullName']?.[0] ?? [user.firstName, user.lastName].filter(Boolean).join(' ').trim() ?? '';
  const displayName = fullName || user.email || user.username || user.id;
  const identityDocument = user.attributes?.['identity-document']?.[0] ?? user.attributes?.['identityDocument']?.[0];

  return {
    id: user.id,
    email: user.email,
    username: user.username,
    fullName: fullName || undefined,
    displayName,
    identityDocument,
    enabled: user.enabled,
  };
}

export function mapGrant(grant: GrantRecord): KeycloakPermissionGrant {
  return {
    id: grant.id,
    userId: grant.userId,
    userEmail: grant.userEmail ?? undefined,
    userDisplayName: grant.userDisplayName ?? undefined,
    clientId: grant.clientId,
    roleName: grant.roleName,
    permission: grant.permission,
    source: 'direct',
    validFrom: grant.validFrom?.toISOString() ?? null,
    validUntil: grant.validUntil?.toISOString() ?? null,
    status: getValidityStatus(grant.validFrom, grant.validUntil),
    createdAt: grant.createdAt.toISOString(),
    createdById: grant.createdById ?? undefined,
    updatedAt: grant.updatedAt.toISOString(),
    updatedById: grant.updatedById ?? undefined,
    lastSyncedAt: grant.lastSyncedAt?.toISOString(),
    lastSyncError: grant.lastSyncError ?? undefined,
  };
}

export function mapGroupRoleGrant(grant: GroupRoleGrantRecord): PermissionGroupRoleGrant {
  return {
    id: grant.id,
    groupKey: grant.groupKey as PermissionGroupKey,
    clientId: grant.clientId,
    roleName: grant.roleName,
    permission: grant.permission,
    source: 'database',
    validFrom: grant.validFrom?.toISOString() ?? null,
    validUntil: grant.validUntil?.toISOString() ?? null,
    status: getValidityStatus(grant.validFrom, grant.validUntil),
    createdAt: grant.createdAt.toISOString(),
    createdById: grant.createdById ?? undefined,
    updatedAt: grant.updatedAt.toISOString(),
    updatedById: grant.updatedById ?? undefined,
    lastSyncedAt: grant.lastSyncedAt?.toISOString(),
    lastSyncError: grant.lastSyncError ?? undefined,
  };
}

export function mapMembership(membership: MembershipRecord): PermissionGroupMembership {
  const group = getPermissionGroupDefinition(membership.entity as PermissionGroupKey);

  return {
    id: membership.id,
    groupKey: group.key,
    keycloakGroupId: group.keycloakGroupId,
    keycloakGroupPath: group.keycloakGroupPath,
    discordRoleId: group.discordRoleId,
    userId: membership.userId,
    userEmail: membership.userEmail ?? undefined,
    userDisplayName: membership.userDisplayName ?? undefined,
    validFrom: membership.mandateStart.toISOString(),
    validUntil: membership.mandateEnd?.toISOString() ?? null,
    status: getMembershipStatus(membership.mandateStart, membership.mandateEnd),
    createdAt: membership.createdAt.toISOString(),
    createdById: membership.createdById ?? undefined,
    updatedAt: membership.updatedAt.toISOString(),
    updatedById: membership.updatedById ?? undefined,
    lastSyncedAt: membership.lastSyncedAt?.toISOString(),
    lastSyncError: membership.lastSyncError ?? undefined,
  };
}

export function fallbackAccountManagerDefinitions(): KeycloakPermissionDefinition[] {
  const client = KEYCLOAK_PERMISSION_CLIENTS.find((definition) => definition.clientId === 'cacic-account-manager');

  return ACCOUNT_MANAGER_ASSIGNABLE_ROLE_CATALOG.map((roleName) => ({
    permission: buildKeycloakPermissionId('cacic-account-manager', roleName),
    clientId: 'cacic-account-manager',
    clientLabel: client?.label ?? 'Conta CACiC',
    roleName,
    label: getRoleLabel(roleName),
    source: 'fallback',
  }));
}

export function getRoleLabel(roleName: string): string {
  const labels: Record<string, string> = {
    access: 'Acesso',
    'super-admin': 'Super Admin - Permissões totais (PERIGOSO!)',
    'discord-management#read': 'Ler Discord',
    'discord-management#update': 'Gerenciar Discord',
    'student-verification#read': 'Ler validações estudantis',
    'student-verification#review': 'Revisar validações estudantis',
    'student-verification#download': 'Baixar documentos de validação',
    'account-deletion#read': 'Ler fila de exclusão',
    'account-deletion#update': 'Gerenciar fila de exclusão',
    'permission-grant#read': 'Ler permissões',
    'permission-grant#assign': 'Atribuir permissões',
    'permission-grant#revoke': 'Revogar permissões',
    'permission-grant#sync': 'Sincronizar permissões',
  };

  return labels[roleName] ?? roleName;
}

export function isHiddenRole(roleName: string): boolean {
  return HIDDEN_KEYCLOAK_ROLE_NAMES.includes(roleName as (typeof HIDDEN_KEYCLOAK_ROLE_NAMES)[number]);
}

export function isDbManagedRole(roleName: string): boolean {
  return !isHiddenRole(roleName);
}

function normalizeRequiredDate(value: string, fieldLabel: string): Date {
  const date = normalizeOptionalDate(value, fieldLabel);
  if (!date) {
    throw new BadRequestException(`Informe ${fieldLabel}.`);
  }

  return date;
}

function normalizeOptionalDate(value: string | Date | null | undefined, fieldLabel: string): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`Informe uma data válida para ${fieldLabel}.`);
  }

  return date;
}

function getValidityStatus(validFrom: Date | null, validUntil: Date | null): KeycloakPermissionGrantStatus {
  const now = Date.now();
  if (validUntil && validUntil.getTime() <= now) {
    return 'expired';
  }

  if (validFrom && validFrom.getTime() > now) {
    return 'scheduled';
  }

  return 'active';
}

function getMembershipStatus(validFrom: Date, validUntil: Date | null): PermissionGroupMembershipStatus {
  const now = Date.now();
  if (validUntil && validUntil.getTime() <= now) {
    return 'expired';
  }

  if (validFrom.getTime() > now) {
    return 'scheduled';
  }

  return 'active';
}

function sameInstant(left: Date | string | null | undefined, right: Date | string | null | undefined): boolean {
  const leftTime = left ? new Date(left).getTime() : null;
  const rightTime = right ? new Date(right).getTime() : null;
  return leftTime === rightTime;
}
