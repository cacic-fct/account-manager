import {
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionUser,
  PermissionSelfRemovalResult,
} from '@cacic/shared-types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { KeycloakClientRoleNotFoundException } from '../auth/exceptions/keycloak-client-role-not-found.exception';
import { AccountPermissionService } from '../auth/services/account-permission.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  hasSameValidityWindow,
  isGrantActive,
  mapGrant,
  mapKeycloakUser,
  normalizePermission,
  normalizeValidityWindow,
  parsePermissionOrThrow,
  PERMISSION_SYNC_ERROR_MESSAGE,
} from './keycloak-permissions.helpers';
import { DB_MANAGED_ROLE_FILTER, GRANT_SELECT, type GrantRecord } from './keycloak-permissions.records';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';

@Injectable()
export class KeycloakPermissionsGrantsService {
  private readonly logger = new Logger(KeycloakPermissionsGrantsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly catalog: KeycloakPermissionsCatalogService,
    private readonly sync: KeycloakPermissionsSyncService,
  ) {}

  async searchUsers(query: string): Promise<KeycloakPermissionUser[]> {
    try {
      const users = await this.keycloakService.searchUsers(query, { max: 20 });
      return users.map((user) => mapKeycloakUser(user));
    } catch (error) {
      this.logger.error('Failed to search accounts for permission management', error);
      throw new ServiceUnavailableException(
        'Não foi possível pesquisar contas agora. Tente novamente em alguns minutos.',
      );
    }
  }

  async listUserGrants(userId: string): Promise<KeycloakPermissionGrant[]> {
    const grants = await this.prisma.keycloakPermissionGrant.findMany({
      where: {
        userId,
        deletedAt: null,
        studentEntityMembershipId: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: GRANT_SELECT,
      orderBy: [{ clientId: 'asc' }, { roleName: 'asc' }],
    });

    return grants.map((grant) => mapGrant(grant));
  }

  async createGrant(input: KeycloakPermissionGrantCreateRequest, actorId?: string): Promise<KeycloakPermissionGrant> {
    const permission = normalizePermission(input.permission);
    await this.catalog.assertPermissionsKnown([permission]);
    if (!actorId) {
      throw new ForbiddenException('Entre novamente para continuar.');
    }
    await this.assertActorCanAssignPermission(actorId, permission);

    const parsedPermission = parsePermissionOrThrow(permission);
    const userId = input.userId.trim();
    if (!userId) {
      throw new BadRequestException('Informe a pessoa que receberá a permissão.');
    }

    const validity = normalizeValidityWindow(input.validFrom, input.validUntil);
    let user: Awaited<ReturnType<KeycloakService['getUserBasicInfo']>>;
    try {
      user = await this.keycloakService.getUserBasicInfo(userId);
    } catch (error) {
      this.logger.error('Failed to look up the account for a permission grant', error);
      throw new ServiceUnavailableException(
        'Não foi possível consultar a conta agora. Tente novamente em alguns minutos.',
      );
    }
    if (!user) {
      throw new NotFoundException('A conta informada não foi encontrada.');
    }

    const existingGrant = await this.findNonDeletedDirectGrant(userId, permission);
    if (existingGrant) {
      if (hasSameValidityWindow(existingGrant, validity)) {
        return mapGrant(existingGrant);
      }

      throw new ConflictException(
        'Essa permissão já foi concedida para essa pessoa. Atualize ou remova a concessão atual antes de criar outra.',
      );
    }

    const mappedUser = mapKeycloakUser(user);
    let grant: GrantRecord;
    try {
      grant = await this.prisma.keycloakPermissionGrant.create({
        data: {
          userId,
          userEmail: mappedUser.email,
          userDisplayName: mappedUser.displayName,
          permission,
          clientId: parsedPermission.clientId,
          roleName: parsedPermission.roleName,
          validFrom: validity.validFrom,
          validUntil: validity.validUntil,
          createdById: actorId,
          updatedById: actorId,
        },
        select: GRANT_SELECT,
      });
    } catch (error) {
      if (this.isUniqueConstraintError(error)) {
        throw new ConflictException(
          'Essa permissão já foi concedida para essa pessoa. Atualize ou remova a concessão atual antes de criar outra.',
        );
      }

      throw error;
    }

    await this.sync.syncGrantAfterWrite(grant, {
      throwOnFailure: false,
    });
    return this.getGrantOrThrow(grant.id);
  }

  async updateGrant(
    id: string,
    input: KeycloakPermissionGrantUpdateRequest,
    actorId?: string,
  ): Promise<KeycloakPermissionGrant> {
    const existingGrant = await this.getDirectGrantRecordOrThrow(id);
    const nextPermission = input.permission ? normalizePermission(input.permission) : existingGrant.permission;
    await this.catalog.assertPermissionsKnown([nextPermission]);
    if (!actorId) {
      throw new ForbiddenException('Entre novamente para continuar.');
    }

    const parsedPermission = parsePermissionOrThrow(nextPermission);
    const validity = normalizeValidityWindow(
      input.validFrom === undefined ? existingGrant.validFrom : input.validFrom,
      input.validUntil === undefined ? existingGrant.validUntil : input.validUntil,
    );
    const now = new Date();
    const wasActive = isGrantActive(existingGrant, now);
    const willBeActive =
      (!validity.validFrom || validity.validFrom.getTime() <= now.getTime()) &&
      (!validity.validUntil || validity.validUntil.getTime() > now.getTime());
    const willProvideAccess = !validity.validUntil || validity.validUntil.getTime() > now.getTime();
    const isGrantingNewActiveAccess = willProvideAccess && (!wasActive || nextPermission !== existingGrant.permission);
    const isKeepingActiveAccessWithValidityChange =
      wasActive &&
      willBeActive &&
      nextPermission === existingGrant.permission &&
      !hasSameValidityWindow(existingGrant, validity);
    const isShorteningActiveAccess =
      wasActive &&
      willBeActive &&
      !!validity.validUntil &&
      (!existingGrant.validUntil || validity.validUntil.getTime() < existingGrant.validUntil.getTime());
    if (isGrantingNewActiveAccess || (isKeepingActiveAccessWithValidityChange && !isShorteningActiveAccess)) {
      await this.assertActorCanAssignPermission(actorId, nextPermission);
    }
    const duplicateGrant = await this.findNonDeletedDirectGrant(existingGrant.userId, nextPermission, existingGrant.id);
    if (duplicateGrant) {
      throw new ConflictException('Essa permissão já foi concedida.');
    }

    if (wasActive && (nextPermission !== existingGrant.permission || !willBeActive || isShorteningActiveAccess)) {
      await this.assertActorCanRevokePermission(actorId, existingGrant.permission);
    }

    const removedPreviousPermission = wasActive && nextPermission !== existingGrant.permission;
    if (removedPreviousPermission) {
      try {
        await this.keycloakService.removeUserClientRoles(
          existingGrant.userId,
          [existingGrant.roleName],
          existingGrant.clientId,
        );
      } catch (error) {
        this.logger.error('Failed to update an existing permission in the authentication service', error);
        throw new ServiceUnavailableException(
          'Não foi possível atualizar a permissão agora. Atualize a lista antes de tentar novamente.',
        );
      }
    }

    let grant: GrantRecord;
    try {
      grant = await this.prisma.keycloakPermissionGrant.update({
        where: { id },
        data: {
          permission: nextPermission,
          clientId: parsedPermission.clientId,
          roleName: parsedPermission.roleName,
          validFrom: validity.validFrom,
          validUntil: validity.validUntil,
          updatedById: actorId,
          lastSyncError: null,
        },
        select: GRANT_SELECT,
      });
    } catch (error) {
      if (removedPreviousPermission) {
        try {
          await this.keycloakService.addUserClientRoles(
            existingGrant.userId,
            [existingGrant.roleName],
            existingGrant.clientId,
          );
        } catch {
          // The database still contains the previous desired state, so the
          // scheduled reconciler can restore it after a transient failure.
        }
      }
      throw error;
    }

    try {
      await this.sync.syncGrantAfterWrite(grant, {
        removeIfPreviouslyActive: wasActive,
      });
    } catch (error) {
      this.logger.error('Failed to synchronize an updated permission', error);
      throw new ServiceUnavailableException(PERMISSION_SYNC_ERROR_MESSAGE);
    }
    return this.getGrantOrThrow(id);
  }

  async deleteGrant(
    id: string,
    actorId?: string,
    options: { enforceActorPermission?: boolean } = {
      enforceActorPermission: true,
    },
  ): Promise<void> {
    const grant = await this.getDirectGrantRecordOrThrow(id);
    if (options.enforceActorPermission !== false) {
      if (!actorId) {
        throw new ForbiddenException('Entre novamente para continuar.');
      }
      await this.assertActorCanRevokePermission(actorId, grant.permission);
    }

    try {
      await this.keycloakService.removeUserClientRoles(grant.userId, [grant.roleName], grant.clientId);
      const now = new Date();
      await this.prisma.keycloakPermissionGrant.update({
        where: { id },
        data: {
          deletedAt: now,
          updatedById: actorId,
          lastSyncedAt: now,
          lastSyncError: null,
        },
      });
    } catch (error) {
      if (this.isMissingKeycloakClientRoleError(error, grant)) {
        const now = new Date();
        await this.prisma.keycloakPermissionGrant.update({
          where: { id },
          data: {
            deletedAt: now,
            updatedById: actorId,
            lastSyncedAt: now,
            lastSyncError: null,
          },
        });
        return;
      }

      await this.prisma.keycloakPermissionGrant.update({
        where: { id },
        data: {
          lastSyncError: 'Não foi possível remover a permissão do sistema de autenticação. Ela pode continuar ativa.',
        },
      });
      this.logger.error('Failed to revoke a Keycloak permission grant', error);
      throw new ServiceUnavailableException(
        'Não foi possível remover a permissão agora. Ela pode continuar ativa; atualize a lista antes de tentar novamente.',
      );
    }
  }

  async selfRemoveGrant(userId: string, grantId: string): Promise<PermissionSelfRemovalResult> {
    const grant = await this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        id: grantId,
        userId,
        deletedAt: null,
        studentEntityMembershipId: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: { id: true },
    });

    if (!grant) {
      throw new NotFoundException('Permissão não encontrada.');
    }

    await this.deleteGrant(grantId, userId, { enforceActorPermission: false });
    return { removed: true, id: grantId };
  }

  private async getGrantOrThrow(id: string): Promise<KeycloakPermissionGrant> {
    const grant = await this.getDirectGrantRecordOrThrow(id);
    return mapGrant(grant);
  }

  private async getDirectGrantRecordOrThrow(id: string): Promise<GrantRecord> {
    const grant = await this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        id,
        deletedAt: null,
        studentEntityMembershipId: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: GRANT_SELECT,
    });

    if (!grant) {
      throw new NotFoundException('Concessão não encontrada.');
    }

    return grant;
  }

  private findNonDeletedDirectGrant(
    userId: string,
    permission: string,
    exceptId?: string,
  ): Promise<GrantRecord | null> {
    return this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        ...(exceptId ? { id: { not: exceptId } } : {}),
        userId,
        permission,
        deletedAt: null,
        studentEntityMembershipId: null,
        roleName: DB_MANAGED_ROLE_FILTER,
      },
      select: GRANT_SELECT,
    });
  }

  private isMissingKeycloakClientRoleError(error: unknown, grant: GrantRecord): boolean {
    return (
      error instanceof KeycloakClientRoleNotFoundException &&
      error.clientId === grant.clientId &&
      error.roleName === grant.roleName
    );
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002';
  }

  private async assertActorCanAssignPermission(actorId: string, permission: string): Promise<void> {
    if (!(await this.accountPermissionService.canAssignPermission(actorId, permission))) {
      throw new ForbiddenException('Você não pode conceder uma permissão que não possui.');
    }
  }

  private async assertActorCanRevokePermission(actorId: string, permission: string): Promise<void> {
    if (!(await this.accountPermissionService.canRevokePermission(actorId, permission))) {
      throw new ForbiddenException('Você não pode revogar uma permissão que não possui.');
    }
  }
}
