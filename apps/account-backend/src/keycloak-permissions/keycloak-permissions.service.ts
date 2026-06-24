import {
  AssignableKeycloakPermission,
  KEYCLOAK_PERMISSION_CATALOG,
  KEYCLOAK_PERMISSION_SET,
  STUDENT_ENTITY_CATALOG,
  STUDENT_ENTITY_SET,
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantStatus,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionSyncResult,
  KeycloakPermissionUser,
  StudentEntityDefinition,
  StudentEntityKey,
  StudentEntityMembership,
  StudentEntityMembershipCreateRequest,
  StudentEntityMembershipStatus,
  StudentEntityMembershipUpdateRequest,
  StudentEntitySyncResult,
} from '@cacic/shared-types';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import {
  KeycloakService,
  KeycloakUserData,
} from '../auth/services/keycloak.service';
import {
  KEYCLOAK_PERMISSION_JOBS,
  KEYCLOAK_PERMISSIONS_QUEUE,
  SyncPermissionGrantsJob,
} from './keycloak-permissions.queue';

const SYNC_ACTOR_ID = 'system:keycloak-permissions-sync';
const ASSIGNABLE_KEYCLOAK_PERMISSIONS = KEYCLOAK_PERMISSION_CATALOG.map(
  (definition) => definition.permission,
);

const GRANT_SELECT = {
  id: true,
  userId: true,
  userEmail: true,
  userDisplayName: true,
  studentEntityMembershipId: true,
  permission: true,
  validFrom: true,
  validUntil: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  updatedById: true,
  deletedAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
} satisfies Prisma.KeycloakPermissionGrantSelect;

type GrantRecord = Prisma.KeycloakPermissionGrantGetPayload<{
  select: typeof GRANT_SELECT;
}>;

const MEMBERSHIP_SELECT = {
  id: true,
  entity: true,
  keycloakGroupPath: true,
  userId: true,
  userEmail: true,
  userDisplayName: true,
  mandateStart: true,
  mandateEnd: true,
  createdAt: true,
  createdById: true,
  updatedAt: true,
  updatedById: true,
  deletedAt: true,
  lastSyncedAt: true,
  lastSyncError: true,
  permissionGrants: {
    where: {
      deletedAt: null,
      permission: {
        in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
      },
    },
    select: GRANT_SELECT,
    orderBy: [{ permission: 'asc' }, { createdAt: 'asc' }],
  },
} satisfies Prisma.StudentEntityMembershipSelect;

type MembershipRecord = Prisma.StudentEntityMembershipGetPayload<{
  select: typeof MEMBERSHIP_SELECT;
}>;

type NormalizedValidityWindow = {
  validFrom: Date | null;
  validUntil: Date | null;
};

type NormalizedMandateWindow = {
  mandateStart: Date;
  mandateEnd: Date;
};

@Injectable()
export class KeycloakPermissionsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(KeycloakPermissionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
    @InjectQueue(KEYCLOAK_PERMISSIONS_QUEUE)
    private readonly permissionQueue: Queue<SyncPermissionGrantsJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.permissionQueue.add(
      KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS,
      { reason: 'scheduled' },
      {
        jobId: 'keycloak-permission-grants-sync',
        repeat: { pattern: '*/15 * * * *' },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  listCatalog(): readonly KeycloakPermissionDefinition[] {
    return KEYCLOAK_PERMISSION_CATALOG;
  }

  listStudentEntities(): readonly StudentEntityDefinition[] {
    return STUDENT_ENTITY_CATALOG;
  }

  async searchUsers(query: string): Promise<KeycloakPermissionUser[]> {
    const users = await this.keycloakService.searchUsers(query, { max: 20 });
    return users.map((user) => this.mapKeycloakUser(user));
  }

  async listStudentEntityMemberships(
    entity?: StudentEntityKey,
  ): Promise<StudentEntityMembership[]> {
    const normalizedEntity = entity
      ? this.normalizeStudentEntity(entity)
      : null;
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        deletedAt: null,
        ...(normalizedEntity ? { entity: normalizedEntity } : {}),
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [
        { entity: 'asc' },
        { mandateEnd: 'desc' },
        { userDisplayName: 'asc' },
      ],
    });

    return memberships.map((membership) => this.mapMembership(membership));
  }

  async listUserMemberships(
    userId: string,
  ): Promise<StudentEntityMembership[]> {
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        userId,
        deletedAt: null,
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [{ entity: 'asc' }, { mandateEnd: 'desc' }],
    });

    return memberships.map((membership) => this.mapMembership(membership));
  }

  async createStudentEntityMembership(
    input: StudentEntityMembershipCreateRequest,
    actorId?: string,
  ): Promise<StudentEntityMembership> {
    const entity = this.normalizeStudentEntity(input.entity);
    const definition = this.getStudentEntityDefinition(entity);
    const userId = input.userId.trim();
    if (!userId) {
      throw new BadRequestException(
        'Informe o usuário que receberá o mandato.',
      );
    }

    const mandate = this.normalizeMandateWindow(
      input.mandateStart,
      input.mandateEnd,
    );
    const permissions = this.normalizePermissionList(input.permissions);
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
          entity,
          deletedAt: null,
        },
        select: { id: true },
      });
    if (existingMembership) {
      throw new ConflictException(
        'Esse usuário já possui um mandato ativo nessa entidade.',
      );
    }

    await this.assertPermissionsAvailable(userId, permissions);

    const mappedUser = this.mapKeycloakUser(user);
    const membership = await this.createMembershipRecord(
      entity,
      definition.keycloakGroupPath,
      userId,
      mappedUser,
      mandate,
      actorId,
    );

    await this.reconcileMembershipPermissions(
      membership,
      permissions,
      actorId,
      {
        throwOnSyncFailure: false,
      },
    );
    await this.syncMembershipAfterWrite(membership, {
      throwOnFailure: false,
    });

    return this.getMembershipOrThrow(membership.id);
  }

  async updateStudentEntityMembership(
    id: string,
    input: StudentEntityMembershipUpdateRequest,
    actorId?: string,
  ): Promise<StudentEntityMembership> {
    const existingMembership = await this.getMembershipRecordOrThrow(id);
    const wasActive = this.isMembershipActive(existingMembership, new Date());
    const mandate = this.normalizeMandateWindow(
      input.mandateStart,
      input.mandateEnd,
    );
    const permissions = this.normalizePermissionList(input.permissions);
    await this.assertPermissionsAvailable(
      existingMembership.userId,
      permissions,
      existingMembership.id,
    );

    const membership = await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        mandateStart: mandate.mandateStart,
        mandateEnd: mandate.mandateEnd,
        updatedById: actorId,
        lastSyncError: null,
      },
      select: MEMBERSHIP_SELECT,
    });

    await this.reconcileMembershipPermissions(membership, permissions, actorId);
    await this.syncMembershipAfterWrite(membership, {
      removeIfPreviouslyActive: wasActive,
    });

    return this.getMembershipOrThrow(id);
  }

  async deleteStudentEntityMembership(
    id: string,
    actorId?: string,
  ): Promise<void> {
    const membership = await this.getMembershipRecordOrThrow(id);
    for (const grant of membership.permissionGrants) {
      await this.deleteGrant(grant.id, actorId, {
        allowMembershipLinked: true,
      });
    }

    await this.keycloakService.removeUserFromGroupPath(
      membership.userId,
      membership.keycloakGroupPath,
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
  }

  async listUserGrants(userId: string): Promise<KeycloakPermissionGrant[]> {
    const grants = await this.prisma.keycloakPermissionGrant.findMany({
      where: {
        userId,
        deletedAt: null,
        permission: {
          in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
        },
      },
      select: GRANT_SELECT,
      orderBy: [{ permission: 'asc' }, { createdAt: 'asc' }],
    });

    return grants.map((grant) => this.mapGrant(grant));
  }

  async createGrant(
    input: KeycloakPermissionGrantCreateRequest,
    actorId?: string,
  ): Promise<KeycloakPermissionGrant> {
    const permission = this.normalizePermission(input.permission);
    const userId = input.userId.trim();
    if (!userId) {
      throw new BadRequestException(
        'Informe o usuário que receberá a permissão.',
      );
    }

    const validity = this.normalizeValidityWindow(
      input.validFrom,
      input.validUntil,
    );
    const user = await this.keycloakService.getUserBasicInfo(userId);
    if (!user) {
      throw new NotFoundException(
        `Usuário ${userId} não foi encontrado no Keycloak.`,
      );
    }

    const existingGrant = await this.findActiveGrant(userId, permission);
    if (existingGrant) {
      if (this.hasSameValidityWindow(existingGrant, validity)) {
        return this.mapGrant(existingGrant);
      }

      throw new ConflictException(
        'Essa permissão já foi concedida para esse usuário. Atualize ou remova a concessão atual antes de criar outra.',
      );
    }

    const grant = await this.createGrantRecord(
      userId,
      permission,
      validity,
      this.mapKeycloakUser(user),
      undefined,
      actorId,
    );

    await this.syncGrantAfterWrite(grant, {
      throwOnFailure: false,
    });
    return this.getGrantOrThrow(grant.id);
  }

  async updateGrant(
    id: string,
    input: KeycloakPermissionGrantUpdateRequest,
    actorId?: string,
    options: { allowMembershipLinked?: boolean } = {},
  ): Promise<KeycloakPermissionGrant> {
    const existingGrant = await this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        id,
        deletedAt: null,
        permission: {
          in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
        },
      },
      select: GRANT_SELECT,
    });

    if (!existingGrant) {
      throw new NotFoundException(`Concessão ${id} não foi encontrada.`);
    }
    if (
      existingGrant.studentEntityMembershipId &&
      !options.allowMembershipLinked
    ) {
      throw new BadRequestException(
        'Permissões vinculadas a mandato devem ser alteradas pelo mandato.',
      );
    }

    const validity = this.normalizeValidityWindow(
      input.validFrom,
      input.validUntil,
    );
    const wasActive = this.isGrantActive(existingGrant, new Date());
    const grant = await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        validFrom: validity.validFrom,
        validUntil: validity.validUntil,
        updatedById: actorId,
        lastSyncError: null,
      },
      select: GRANT_SELECT,
    });

    await this.syncGrantAfterWrite(grant, {
      removeIfPreviouslyActive: wasActive,
    });
    return this.getGrantOrThrow(id);
  }

  async deleteGrant(
    id: string,
    actorId?: string,
    options: { allowMembershipLinked?: boolean } = {},
  ): Promise<void> {
    const grant = await this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        id,
        deletedAt: null,
        permission: {
          in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
        },
      },
      select: GRANT_SELECT,
    });

    if (!grant) {
      throw new NotFoundException(`Concessão ${id} não foi encontrada.`);
    }
    if (grant.studentEntityMembershipId && !options.allowMembershipLinked) {
      throw new BadRequestException(
        'Permissões vinculadas a mandato devem ser removidas pelo mandato.',
      );
    }

    await this.keycloakService.removeUserClientRoles(grant.userId, [
      grant.permission,
    ]);
    await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedById: actorId,
        lastSyncedAt: new Date(),
        lastSyncError: null,
      },
    });
  }

  async enqueueSync(reason: 'manual' | 'scheduled' = 'manual'): Promise<void> {
    await this.permissionQueue.add(
      KEYCLOAK_PERMISSION_JOBS.SYNC_GRANTS,
      { reason },
      {
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  async synchronizePermissionGrants(): Promise<KeycloakPermissionSyncResult> {
    const now = new Date();
    const grants = await this.prisma.keycloakPermissionGrant.findMany({
      where: {
        deletedAt: null,
        permission: {
          in: ASSIGNABLE_KEYCLOAK_PERMISSIONS,
        },
      },
      select: GRANT_SELECT,
      orderBy: [{ validUntil: 'asc' }, { validFrom: 'asc' }],
    });
    const result: KeycloakPermissionSyncResult = {
      activated: 0,
      expired: 0,
      failed: 0,
    };

    for (const grant of grants) {
      if (!this.isManagedPermission(grant.permission)) {
        continue;
      }

      try {
        if (this.isGrantExpired(grant, now)) {
          await this.expireGrant(grant, now);
          result.expired += 1;
          continue;
        }

        if (this.isGrantActive(grant, now)) {
          await this.activateGrant(grant, now);
          result.activated += 1;
        }
      } catch (error) {
        result.failed += 1;
        await this.recordSyncFailure(grant.id, error);
      }
    }

    return result;
  }

  async synchronizeStudentEntityMemberships(): Promise<StudentEntitySyncResult> {
    const now = new Date();
    const memberships = await this.prisma.studentEntityMembership.findMany({
      where: {
        deletedAt: null,
      },
      select: MEMBERSHIP_SELECT,
      orderBy: [{ mandateEnd: 'asc' }, { mandateStart: 'asc' }],
    });
    const result: StudentEntitySyncResult = {
      activated: 0,
      expired: 0,
      failed: 0,
    };

    for (const membership of memberships) {
      try {
        if (this.isMembershipExpired(membership, now)) {
          await this.expireMembership(membership, now);
          result.expired += 1;
          continue;
        }

        if (this.isMembershipActive(membership, now)) {
          await this.activateMembership(membership, now);
          result.activated += 1;
        }
      } catch (error) {
        result.failed += 1;
        await this.recordMembershipSyncFailure(membership.id, error);
      }
    }

    return result;
  }

  private async syncGrantAfterWrite(
    grant: GrantRecord,
    options: {
      removeIfPreviouslyActive?: boolean;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<void> {
    const now = new Date();

    if (!this.isManagedPermission(grant.permission)) {
      return;
    }

    try {
      if (this.isGrantActive(grant, now)) {
        await this.activateGrant(grant, now);
        return;
      }

      if (options.removeIfPreviouslyActive) {
        await this.keycloakService.removeUserClientRoles(grant.userId, [
          grant.permission,
        ]);
        await this.markSynced(grant.id, now);
      }
    } catch (error) {
      await this.recordSyncFailure(grant.id, error);
      if (options.throwOnFailure ?? true) {
        throw error;
      }
    }
  }

  private async syncMembershipAfterWrite(
    membership: MembershipRecord,
    options: {
      removeIfPreviouslyActive?: boolean;
      throwOnFailure?: boolean;
    } = {},
  ): Promise<void> {
    const now = new Date();

    try {
      if (this.isMembershipActive(membership, now)) {
        await this.activateMembership(membership, now);
        return;
      }

      if (options.removeIfPreviouslyActive) {
        await this.keycloakService.removeUserFromGroupPath(
          membership.userId,
          membership.keycloakGroupPath,
        );
        await this.markMembershipSynced(membership.id, now);
      }
    } catch (error) {
      await this.recordMembershipSyncFailure(membership.id, error);
      if (options.throwOnFailure ?? true) {
        throw error;
      }
    }
  }

  private async activateGrant(grant: GrantRecord, now: Date): Promise<void> {
    if (!this.isManagedPermission(grant.permission)) {
      return;
    }

    await this.keycloakService.addUserClientRoles(grant.userId, [
      grant.permission,
    ]);
    await this.markSynced(grant.id, now);
  }

  private async expireGrant(grant: GrantRecord, now: Date): Promise<void> {
    if (this.isManagedPermission(grant.permission)) {
      await this.keycloakService.removeUserClientRoles(grant.userId, [
        grant.permission,
      ]);
    }

    await this.prisma.keycloakPermissionGrant.update({
      where: { id: grant.id },
      data: {
        deletedAt: now,
        updatedById: SYNC_ACTOR_ID,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async activateMembership(
    membership: MembershipRecord,
    now: Date,
  ): Promise<void> {
    await this.keycloakService.addUserToGroupPath(
      membership.userId,
      membership.keycloakGroupPath,
    );
    await this.markMembershipSynced(membership.id, now);
  }

  private async expireMembership(
    membership: MembershipRecord,
    now: Date,
  ): Promise<void> {
    await this.keycloakService.removeUserFromGroupPath(
      membership.userId,
      membership.keycloakGroupPath,
    );

    for (const grant of membership.permissionGrants) {
      await this.expireGrant(grant, now);
    }

    await this.prisma.studentEntityMembership.update({
      where: { id: membership.id },
      data: {
        deletedAt: now,
        updatedById: SYNC_ACTOR_ID,
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async markSynced(id: string, now: Date): Promise<void> {
    await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async markMembershipSynced(id: string, now: Date): Promise<void> {
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        lastSyncedAt: now,
        lastSyncError: null,
      },
    });
  }

  private async recordSyncFailure(id: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Failed to sync Keycloak permission grant', {
      grantId: id,
      error: message,
    });
    await this.prisma.keycloakPermissionGrant.update({
      where: { id },
      data: {
        lastSyncError: message,
      },
    });
  }

  private async recordMembershipSyncFailure(
    id: string,
    error: unknown,
  ): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error('Failed to sync student entity membership', {
      membershipId: id,
      error: message,
    });
    await this.prisma.studentEntityMembership.update({
      where: { id },
      data: {
        lastSyncError: message,
      },
    });
  }

  private async getGrantOrThrow(id: string): Promise<KeycloakPermissionGrant> {
    const grant = await this.prisma.keycloakPermissionGrant.findUnique({
      where: { id },
      select: GRANT_SELECT,
    });

    if (!grant) {
      throw new NotFoundException(`Concessão ${id} não foi encontrada.`);
    }

    return this.mapGrant(grant);
  }

  private async getMembershipOrThrow(
    id: string,
  ): Promise<StudentEntityMembership> {
    return this.mapMembership(await this.getMembershipRecordOrThrow(id));
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
      throw new NotFoundException(`Mandato ${id} não foi encontrado.`);
    }

    return membership;
  }

  private async findActiveGrant(
    userId: string,
    permission: AssignableKeycloakPermission,
  ): Promise<GrantRecord | null> {
    return this.prisma.keycloakPermissionGrant.findFirst({
      where: {
        userId,
        permission,
        deletedAt: null,
      },
      select: GRANT_SELECT,
    });
  }

  private normalizePermission(
    permission: string,
  ): AssignableKeycloakPermission {
    const normalizedPermission = permission.trim();
    if (!this.isManagedPermission(normalizedPermission)) {
      throw new BadRequestException(`Permissão inválida: ${permission}.`);
    }

    return normalizedPermission;
  }

  private normalizePermissionList(
    permissions: readonly string[],
  ): AssignableKeycloakPermission[] {
    return [...new Set(permissions.map((permission) => permission.trim()))].map(
      (permission) => this.normalizePermission(permission),
    );
  }

  private normalizeStudentEntity(entity: string): StudentEntityKey {
    const normalizedEntity = entity.trim().toUpperCase();
    if (!STUDENT_ENTITY_SET.has(normalizedEntity as StudentEntityKey)) {
      throw new BadRequestException(`Entidade estudantil inválida: ${entity}.`);
    }

    return normalizedEntity as StudentEntityKey;
  }

  private getStudentEntityDefinition(
    entity: StudentEntityKey,
  ): StudentEntityDefinition {
    const definition = STUDENT_ENTITY_CATALOG.find(
      (candidate) => candidate.key === entity,
    );
    if (!definition) {
      throw new BadRequestException(`Entidade estudantil inválida: ${entity}.`);
    }

    return definition;
  }

  private normalizeValidityWindow(
    validFrom: string | null | undefined,
    validUntil: string | null | undefined,
  ): NormalizedValidityWindow {
    const normalizedValidFrom = this.parseOptionalDate(validFrom, 'validFrom');
    const normalizedValidUntil = this.parseOptionalDate(
      validUntil,
      'validUntil',
    );

    if (
      normalizedValidFrom &&
      normalizedValidUntil &&
      normalizedValidFrom >= normalizedValidUntil
    ) {
      throw new BadRequestException(
        'A data inicial da permissão deve ser anterior à data final.',
      );
    }

    if (normalizedValidUntil && normalizedValidUntil <= new Date()) {
      throw new BadRequestException(
        'A data final da permissão deve estar no futuro.',
      );
    }

    return {
      validFrom: normalizedValidFrom,
      validUntil: normalizedValidUntil,
    };
  }

  private normalizeMandateWindow(
    mandateStart: string,
    mandateEnd: string,
  ): NormalizedMandateWindow {
    const normalizedStart = this.parseRequiredDate(
      mandateStart,
      'mandateStart',
    );
    const normalizedEnd = this.parseRequiredDate(mandateEnd, 'mandateEnd');

    if (normalizedStart >= normalizedEnd) {
      throw new BadRequestException(
        'A data inicial do mandato deve ser anterior à data final.',
      );
    }

    if (normalizedEnd <= new Date()) {
      throw new BadRequestException(
        'A data final do mandato deve estar no futuro.',
      );
    }

    return {
      mandateStart: normalizedStart,
      mandateEnd: normalizedEnd,
    };
  }

  private parseRequiredDate(value: string, fieldName: string): Date {
    const date = new Date(value);
    if (!value.trim() || Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        `${fieldName} deve ser uma data ISO válida.`,
      );
    }

    return date;
  }

  private parseOptionalDate(
    value: string | null | undefined,
    fieldName: string,
  ): Date | null {
    if (value === undefined || value === null || value.trim() === '') {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      throw new BadRequestException(
        `${fieldName} deve ser uma data ISO válida.`,
      );
    }

    return date;
  }

  private hasSameValidityWindow(
    grant: GrantRecord,
    validity: NormalizedValidityWindow,
  ): boolean {
    return (
      this.sameDate(grant.validFrom, validity.validFrom) &&
      this.sameDate(grant.validUntil, validity.validUntil)
    );
  }

  private sameDate(left: Date | null, right: Date | null): boolean {
    return (left?.getTime() ?? null) === (right?.getTime() ?? null);
  }

  private isManagedPermission(
    permission: string,
  ): permission is AssignableKeycloakPermission {
    return KEYCLOAK_PERMISSION_SET.has(
      permission as AssignableKeycloakPermission,
    );
  }

  private isGrantActive(grant: GrantRecord, now: Date): boolean {
    return (
      !grant.deletedAt &&
      (!grant.validFrom || grant.validFrom <= now) &&
      (!grant.validUntil || grant.validUntil > now)
    );
  }

  private isGrantExpired(grant: GrantRecord, now: Date): boolean {
    return !grant.deletedAt && !!grant.validUntil && grant.validUntil <= now;
  }

  private isMembershipActive(membership: MembershipRecord, now: Date): boolean {
    return (
      !membership.deletedAt &&
      membership.mandateStart <= now &&
      membership.mandateEnd > now
    );
  }

  private isMembershipExpired(
    membership: MembershipRecord,
    now: Date,
  ): boolean {
    return !membership.deletedAt && membership.mandateEnd <= now;
  }

  private mapGrant(grant: GrantRecord): KeycloakPermissionGrant {
    return {
      id: grant.id,
      userId: grant.userId,
      userEmail: grant.userEmail ?? undefined,
      userDisplayName: grant.userDisplayName ?? undefined,
      studentEntityMembershipId: grant.studentEntityMembershipId ?? undefined,
      permission: grant.permission as AssignableKeycloakPermission,
      validFrom: grant.validFrom?.toISOString() ?? null,
      validUntil: grant.validUntil?.toISOString() ?? null,
      status: this.getGrantStatus(grant),
      createdAt: grant.createdAt.toISOString(),
      createdById: grant.createdById ?? undefined,
      updatedAt: grant.updatedAt.toISOString(),
      updatedById: grant.updatedById ?? undefined,
      lastSyncedAt: grant.lastSyncedAt?.toISOString() ?? undefined,
      lastSyncError: grant.lastSyncError ?? undefined,
    };
  }

  private mapMembership(membership: MembershipRecord): StudentEntityMembership {
    return {
      id: membership.id,
      entity: membership.entity as StudentEntityKey,
      keycloakGroupPath: membership.keycloakGroupPath,
      userId: membership.userId,
      userEmail: membership.userEmail ?? undefined,
      userDisplayName: membership.userDisplayName ?? undefined,
      mandateStart: membership.mandateStart.toISOString(),
      mandateEnd: membership.mandateEnd.toISOString(),
      status: this.getMembershipStatus(membership),
      permissionGrants: membership.permissionGrants.map((grant) =>
        this.mapGrant(grant),
      ),
      createdAt: membership.createdAt.toISOString(),
      createdById: membership.createdById ?? undefined,
      updatedAt: membership.updatedAt.toISOString(),
      updatedById: membership.updatedById ?? undefined,
      lastSyncedAt: membership.lastSyncedAt?.toISOString() ?? undefined,
      lastSyncError: membership.lastSyncError ?? undefined,
    };
  }

  private getMembershipStatus(
    membership: MembershipRecord,
  ): StudentEntityMembershipStatus {
    const now = new Date();
    if (this.isMembershipExpired(membership, now)) {
      return 'expired';
    }

    if (membership.mandateStart > now) {
      return 'scheduled';
    }

    return 'active';
  }

  private getGrantStatus(grant: GrantRecord): KeycloakPermissionGrantStatus {
    const now = new Date();
    if (this.isGrantExpired(grant, now)) {
      return 'expired';
    }

    if (grant.validFrom && grant.validFrom > now) {
      return 'scheduled';
    }

    return 'active';
  }

  private async assertPermissionsAvailable(
    userId: string,
    permissions: readonly AssignableKeycloakPermission[],
    studentEntityMembershipId?: string,
  ): Promise<void> {
    for (const permission of permissions) {
      const existingGrant = await this.findActiveGrant(userId, permission);
      if (
        existingGrant &&
        existingGrant.studentEntityMembershipId !== studentEntityMembershipId
      ) {
        throw new ConflictException(
          `A permissão ${permission} já foi concedida para esse usuário.`,
        );
      }
    }
  }

  private async reconcileMembershipPermissions(
    membership: MembershipRecord,
    permissions: readonly AssignableKeycloakPermission[],
    actorId?: string,
    options: { throwOnSyncFailure?: boolean } = {},
  ): Promise<void> {
    const desiredPermissions = new Set(permissions);
    const currentGrants = membership.permissionGrants;
    const currentByPermission = new Map(
      currentGrants.map((grant) => [
        grant.permission as AssignableKeycloakPermission,
        grant,
      ]),
    );
    const validity = {
      validFrom: membership.mandateStart,
      validUntil: membership.mandateEnd,
    };

    for (const grant of currentGrants) {
      if (
        !desiredPermissions.has(
          grant.permission as AssignableKeycloakPermission,
        )
      ) {
        await this.deleteGrant(grant.id, actorId, {
          allowMembershipLinked: true,
        });
      }
    }

    for (const permission of desiredPermissions) {
      const existingGrant = currentByPermission.get(permission);
      if (existingGrant) {
        await this.updateGrant(
          existingGrant.id,
          {
            validFrom: membership.mandateStart.toISOString(),
            validUntil: membership.mandateEnd.toISOString(),
          },
          actorId,
          { allowMembershipLinked: true },
        );
        continue;
      }

      const grant = await this.createGrantRecord(
        membership.userId,
        permission,
        validity,
        {
          id: membership.userId,
          email: membership.userEmail ?? '',
          displayName: membership.userDisplayName ?? membership.userId,
        },
        membership.id,
        actorId,
      );
      await this.syncGrantAfterWrite(grant, {
        throwOnFailure: options.throwOnSyncFailure,
      });
    }
  }

  private async createMembershipRecord(
    entity: StudentEntityKey,
    keycloakGroupPath: string,
    userId: string,
    mappedUser: KeycloakPermissionUser,
    mandate: NormalizedMandateWindow,
    actorId?: string,
  ): Promise<MembershipRecord> {
    try {
      return await this.prisma.studentEntityMembership.create({
        data: {
          entity,
          keycloakGroupPath,
          userId,
          userEmail: mappedUser.email,
          userDisplayName: mappedUser.displayName,
          mandateStart: mandate.mandateStart,
          mandateEnd: mandate.mandateEnd,
          createdById: actorId,
          updatedById: actorId,
        },
        select: MEMBERSHIP_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Esse usuário já possui um mandato ativo nessa entidade.',
        );
      }

      throw error;
    }
  }

  private mapKeycloakUser(user: KeycloakUserData): KeycloakPermissionUser {
    const attributes = user.attributes ?? {};
    const federatedFullName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ')
      .trim();
    const fullName = attributes.fullName?.[0] || federatedFullName || undefined;
    const displayName = fullName || user.email || user.username || user.id;

    return {
      id: user.id,
      email: user.email,
      username: user.username,
      fullName,
      displayName,
      identityDocument:
        attributes['identity-document']?.[0] ??
        attributes.identityDocument?.[0],
      enabled: user.enabled,
    };
  }

  private async createGrantRecord(
    userId: string,
    permission: AssignableKeycloakPermission,
    validity: NormalizedValidityWindow,
    mappedUser: KeycloakPermissionUser,
    studentEntityMembershipId?: string,
    actorId?: string,
  ): Promise<GrantRecord> {
    try {
      return await this.prisma.keycloakPermissionGrant.create({
        data: {
          userId,
          userEmail: mappedUser.email,
          userDisplayName: mappedUser.displayName,
          studentEntityMembershipId,
          permission,
          validFrom: validity.validFrom,
          validUntil: validity.validUntil,
          createdById: actorId,
          updatedById: actorId,
        },
        select: GRANT_SELECT,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Essa permissão já foi concedida para esse usuário.',
        );
      }

      throw error;
    }
  }
}
