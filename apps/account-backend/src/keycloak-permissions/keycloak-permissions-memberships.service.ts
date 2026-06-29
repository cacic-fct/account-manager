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
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { KeycloakService } from '../auth/services/keycloak.service';
import { DiscordRoleService } from '../discord/services/discord-role.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  getPermissionGroupDefinition,
  isMembershipActive,
  mapKeycloakUser,
  mapMembership,
  normalizeMandateWindow,
  normalizePermissionGroupKey,
} from './keycloak-permissions.helpers';
import {
  MEMBERSHIP_SELECT,
  type MembershipRecord,
} from './keycloak-permissions.records';
import { KeycloakPermissionsSyncService } from './keycloak-permissions-sync.service';

@Injectable()
export class KeycloakPermissionsMembershipsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    private readonly discordRoleService: DiscordRoleService,
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
    const wasActive = isMembershipActive(existingMembership, new Date());
    const validity = normalizeMandateWindow(input.validFrom, input.validUntil);
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
      removeIfPreviouslyActive: wasActive,
    });
    await this.discordRoleService.reconcilePermissionGroupAffiliationRoles(
      membership.userId,
      'permission-group-membership-updated',
    );

    return this.getMembershipOrThrow(id);
  }

  async deletePermissionGroupMembership(
    id: string,
    actorId?: string,
  ): Promise<void> {
    const membership = await this.getMembershipRecordOrThrow(id);
    const group = getPermissionGroupDefinition(
      membership.entity as PermissionGroupKey,
    );

    await this.keycloakService.removeUserFromGroupId(
      membership.userId,
      group.keycloakGroupId,
      group.keycloakGroupPath,
    );
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: actorId,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
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

    await this.deletePermissionGroupMembership(membershipId, userId);
    return { removed: true, id: membershipId };
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
