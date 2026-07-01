import {
  PermissionGroupKey,
  PermissionGroupMembership,
  PermissionGroupMembershipCreateRequest,
  PermissionGroupMembershipUpdateRequest,
  PermissionSelfRemovalResult,
} from '@cacic/shared-types';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AccountPermissionService } from '../auth/services/account-permission.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { DiscordRoleService } from '../discord/services/discord-role.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getPermissionGroupDefinition,
  isGrantActive,
  isGroupRoleGrantActive,
  isMembershipActive,
  mapKeycloakUser,
  mapMembership,
  normalizeMandateWindow,
  normalizePermissionGroupKey,
} from './keycloak-permissions.helpers';
import {
  DB_MANAGED_ROLE_FILTER,
  GROUP_ROLE_GRANT_SELECT,
  MEMBERSHIP_SELECT,
  type MembershipRecord,
} from './keycloak-permissions.records';
import { KeycloakPermissionsCatalogService } from './keycloak-permissions-catalog.service';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';

@Injectable()
export class KeycloakPermissionsMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly discordRoleService: DiscordRoleService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly catalog: KeycloakPermissionsCatalogService,
    private readonly sync: KeycloakPermissionsSyncService,
  ) {}

  async listPermissionGroupMemberships(
    groupKey?: PermissionGroupKey,
  ): Promise<PermissionGroupMembership[]> {
    const normalizedGroupKey = groupKey
      ? normalizePermissionGroupKey(groupKey)
      : null;
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        deletedAt: null,
        ...(normalizedGroupKey ? { entity: normalizedGroupKey } : {}),
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [
        { entity: 'asc' },
        { mandateEnd: 'desc' },
        { userDisplayName: 'asc' },
      ],
    });

    return memberships.map((membership) => mapMembership(membership));
  }

  async listUserMemberships(
    userId: string,
  ): Promise<PermissionGroupMembership[]> {
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [{ entity: 'asc' }, { mandateEnd: 'desc' }],
    });

    return memberships.map((membership) => mapMembership(membership));
  }

  async createPermissionGroupMembership(
    input: PermissionGroupMembershipCreateRequest,
    actorId?: string,
  ): Promise<PermissionGroupMembership> {
    const groupKey = normalizePermissionGroupKey(input.groupKey);
    const group = getPermissionGroupDefinition(groupKey);
    const userId = input.userId.trim();
    if (!userId) {
      throw new BadRequestException('Informe a pessoa do vínculo.');
    }

    const validity = normalizeMandateWindow(input.validFrom, input.validUntil);
    const user = await this.keycloakService.getUserBasicInfo(userId);
    if (!user) {
      throw new NotFoundException(
        `Usuário ${userId} não foi encontrado no Keycloak.`,
      );
    }

    const existingMembership =
      await this.prisma.studentEntityMembership.findFirst({
        where: {
          userId,
          entity: groupKey,
          deletedAt: null,
        },
        select: { id: true },
      });
    if (existingMembership) {
      throw new ConflictException(
        'Essa pessoa já possui um vínculo ativo nesse grupo.',
      );
    }
    if (!actorId) {
      throw new ForbiddenException('Authentication required');
    }
    await this.assertActorCanAssignGroupPermissions(actorId, groupKey);

    const mappedUser = mapKeycloakUser(user);
    const membership = await this.prisma.studentEntityMembership.create({
      data: {
        entity: groupKey,
        keycloakGroupPath: group.keycloakGroupPath,
        userId,
        userEmail: mappedUser.email,
        userDisplayName: mappedUser.displayName,
        mandateStart: validity.mandateStart,
        mandateEnd: validity.mandateEnd,
        createdById: actorId,
        updatedById: actorId,
      },
      select: MEMBERSHIP_SELECT,
    });

    await this.sync.syncMembershipAfterWrite(membership, {
      throwOnFailure: false,
    });
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      userId,
      'permission-group-membership-created',
    );

    return this.getMembershipOrThrow(membership.id);
  }

  async updatePermissionGroupMembership(
    id: string,
    input: PermissionGroupMembershipUpdateRequest,
    actorId?: string,
  ): Promise<PermissionGroupMembership> {
    const existingMembership = await this.getMembershipRecordOrThrow(id);
    const now = new Date();
    const wasActive = isMembershipActive(existingMembership, now);
    const validity = normalizeMandateWindow(input.validFrom, input.validUntil);
    const willBeActive =
      validity.mandateStart.getTime() <= now.getTime() &&
      (!validity.mandateEnd || validity.mandateEnd.getTime() > now.getTime());
    const willProvideAccess =
      !validity.mandateEnd || validity.mandateEnd.getTime() > now.getTime();
    const isShorteningActiveAccess =
      wasActive &&
      willBeActive &&
      !!validity.mandateEnd &&
      (!existingMembership.mandateEnd ||
        validity.mandateEnd.getTime() <
          existingMembership.mandateEnd.getTime());
    const extendsActiveAccess =
      wasActive &&
      willBeActive &&
      (!validity.mandateEnd ||
        (!!existingMembership.mandateEnd &&
          validity.mandateEnd.getTime() >
            existingMembership.mandateEnd.getTime()));
    const grantsOrExtendsAccess =
      (!wasActive && willProvideAccess) || extendsActiveAccess;
    const groupKey = existingMembership.entity as PermissionGroupKey;

    if (!actorId) {
      throw new ForbiddenException('Authentication required');
    }
    if (grantsOrExtendsAccess) {
      await this.assertActorCanAssignGroupPermissions(actorId, groupKey);
    }
    if (wasActive && (!willBeActive || isShorteningActiveAccess)) {
      await this.assertActorCanRevokeGroupPermissions(actorId, groupKey);
      await this.assertActorCanRevokeLinkedGrants(actorId, existingMembership);
    }

    const membership = await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        mandateStart: validity.mandateStart,
        mandateEnd: validity.mandateEnd,
        updatedById: actorId,
        lastSyncError: null,
      },
      select: MEMBERSHIP_SELECT,
    });

    await this.sync.syncMembershipAfterWrite(membership, {
      deactivateLinkedGrants: wasActive && !willBeActive ? false : undefined,
      removeIfPreviouslyActive: wasActive,
    });
    if (wasActive && !willBeActive) {
      await this.deactivateLinkedPermissionGrants(membership, actorId, now);
    } else if (isShorteningActiveAccess) {
      await this.shortenLinkedPermissionGrants(membership, actorId);
    }
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      membership.userId,
      'permission-group-membership-updated',
    );

    return this.getMembershipOrThrow(id);
  }

  async deletePermissionGroupMembership(
    id: string,
    actorId?: string,
    options: { enforceActorPermission?: boolean } = {
      enforceActorPermission: true,
    },
  ): Promise<void> {
    const membership = await this.getMembershipRecordOrThrow(id);
    const group = getPermissionGroupDefinition(
      membership.entity as PermissionGroupKey,
    );
    if (options.enforceActorPermission !== false) {
      if (!actorId) {
        throw new ForbiddenException('Authentication required');
      }
      await this.assertActorCanRevokeGroupPermissions(
        actorId,
        membership.entity as PermissionGroupKey,
      );
      await this.assertActorCanRevokeLinkedGrants(actorId, membership);
    }
    const now = new Date();

    await this.keycloakService.removeUserFromGroupId(
      membership.userId,
      group.keycloakGroupId,
      group.keycloakGroupPath,
    );
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        deletedAt: now,
        updatedById: actorId,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
    await this.deactivateLinkedPermissionGrants(membership, actorId, now);
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      membership.userId,
      'permission-group-membership-deleted',
    );
  }

  async selfRemoveMembership(
    userId: string,
    membershipId: string,
  ): Promise<PermissionSelfRemovalResult> {
    const membership = await this.prisma.studentEntityMembership.findFirst({
      where: {
        id: membershipId,
        userId,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (!membership) {
      throw new NotFoundException(
        `Vínculo ${membershipId} não foi encontrado.`,
      );
    }

    await this.deletePermissionGroupMembership(membershipId, userId, {
      enforceActorPermission: false,
    });
    return { removed: true, id: membershipId };
  }

  private async assertActorCanAssignGroupPermissions(
    actorId: string,
    groupKey: PermissionGroupKey,
  ): Promise<void> {
    for (const permission of await this.listActiveGroupPermissions(groupKey)) {
      if (
        !(await this.accountPermissionService.canAssignPermission(
          actorId,
          permission,
        ))
      ) {
        throw new ForbiddenException(
          'Você não pode vincular pessoas a um grupo que concede permissões que você não possui.',
        );
      }
    }
  }

  private async assertActorCanRevokeGroupPermissions(
    actorId: string,
    groupKey: PermissionGroupKey,
  ): Promise<void> {
    for (const permission of await this.listActiveGroupPermissions(groupKey)) {
      if (
        !(await this.accountPermissionService.canRevokePermission(
          actorId,
          permission,
        ))
      ) {
        throw new ForbiddenException(
          'Você não pode remover pessoas de um grupo que concede permissões que você não pode revogar.',
        );
      }
    }
  }

  private async assertActorCanRevokeLinkedGrants(
    actorId: string,
    membership: MembershipRecord,
  ): Promise<void> {
    for (const grant of membership.permissionGrants) {
      if (
        !(await this.accountPermissionService.canRevokePermission(
          actorId,
          grant.permission,
        ))
      ) {
        throw new ForbiddenException(
          'Você não pode remover vínculos com permissões legadas que você não pode revogar.',
        );
      }
    }
  }

  private async listActiveGroupPermissions(
    groupKey: PermissionGroupKey,
  ): Promise<string[]> {
    const now = new Date();
    const group = getPermissionGroupDefinition(groupKey);
    const [dbGrants, keycloakPermissions] = await Promise.all([
      this.prisma.keycloakGroupPermissionGrant.findMany({
        where: {
          groupKey,
          deletedAt: null,
          roleName: DB_MANAGED_ROLE_FILTER,
        },
        select: GROUP_ROLE_GRANT_SELECT,
      }),
      this.catalog.listKeycloakGroupPermissions(group),
    ]);

    return [
      ...new Set([
        ...dbGrants
          .filter((grant) => isGroupRoleGrantActive(grant, now))
          .map((grant) => grant.permission),
        ...keycloakPermissions.map((permission) => permission.permission),
      ]),
    ];
  }

  private async deactivateLinkedPermissionGrants(
    membership: MembershipRecord,
    actorId: string | undefined,
    now: Date,
  ): Promise<void> {
    for (const grant of membership.permissionGrants) {
      if (isGrantActive(grant, now)) {
        await this.keycloakService.removeUserClientRoles(
          grant.userId,
          [grant.roleName],
          grant.clientId,
        );
      }

      await this.prisma.keycloakPermissionGrant.update({
        where: { id: grant.id },
        data: {
          deletedAt: now,
          updatedById: actorId,
          lastSyncedAt: now,
          lastSyncError: null,
        },
      });
    }
  }

  private async shortenLinkedPermissionGrants(
    membership: MembershipRecord,
    actorId: string | undefined,
  ): Promise<void> {
    if (!membership.mandateEnd) {
      return;
    }

    for (const grant of membership.permissionGrants) {
      if (
        grant.validUntil &&
        grant.validUntil.getTime() <= membership.mandateEnd.getTime()
      ) {
        continue;
      }

      await this.prisma.keycloakPermissionGrant.update({
        where: { id: grant.id },
        data: {
          validUntil: membership.mandateEnd,
          updatedById: actorId,
          lastSyncError: null,
        },
      });
    }
  }

  private async getMembershipOrThrow(
    id: string,
  ): Promise<PermissionGroupMembership> {
    return mapMembership(await this.getMembershipRecordOrThrow(id));
  }

  private async getMembershipRecordOrThrow(
    id: string,
  ): Promise<MembershipRecord> {
    const membership = await this.prisma.studentEntityMembership.findFirst({
      where: {
        id,
        deletedAt: null,
      },
      select: MEMBERSHIP_SELECT,
    });

    if (!membership) {
      throw new NotFoundException(`Vínculo ${id} não foi encontrado.`);
    }

    return membership;
  }
}
