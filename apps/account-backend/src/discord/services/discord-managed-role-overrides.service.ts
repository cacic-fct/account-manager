import { Injectable, NotFoundException } from '@nestjs/common';
import type { DiscordManagedRoleOverride as OverrideRecord } from '@prisma/client';
import type {
  DiscordManagedRoleCategory,
  DiscordManagedRoleDefinition,
  DiscordManagedRoleOverride,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakService, KeycloakUserData } from '../../auth/services/keycloak.service';
import {
  DISCORD_MANAGED_ROLES,
  type DiscordManagedRoleCategory as BackendDiscordManagedRoleCategory,
} from '../constants/discord-managed-roles';
import {
  DiscordManagedRoleOverrideCreateDto,
  DiscordManagedRoleOverrideUpdateDto,
} from '../dto/discord-managed-role-overrides.dto';

const MANAGED_ROLE_DESCRIPTIONS: Record<DiscordManagedRoleCategory, { label: string; description: string }> = {
  student: {
    label: 'Aluno da Computação',
    description: 'Força o cargo de aluno quando a verificação automática não cobre o caso.',
  },
  unesp: {
    label: 'Unespiano Visitante',
    description: 'Força o cargo de visitante Unesp mesmo sem todos os sinais automáticos.',
  },
  visitor: {
    label: 'Visitante externo',
    description: 'Força o cargo de visitante externo e remove cargos acadêmicos gerenciados.',
  },
};

@Injectable()
export class DiscordManagedRoleOverridesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly keycloakService: KeycloakService,
  ) {}

  getManagedRoleCatalog(): DiscordManagedRoleDefinition[] {
    return Object.values(DISCORD_MANAGED_ROLES).map((role) => ({
      category: role.category,
      roleId: role.roleId,
      roleName: role.roleName,
      label: MANAGED_ROLE_DESCRIPTIONS[role.category].label,
      description: MANAGED_ROLE_DESCRIPTIONS[role.category].description,
    }));
  }

  async listOverrides(): Promise<DiscordManagedRoleOverride[]> {
    const overrides = await this.prisma.discordManagedRoleOverride.findMany({
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
    });

    return overrides.map((override) => this.mapOverride(override));
  }

  async getOverrideCategoryForUser(userId: string): Promise<BackendDiscordManagedRoleCategory | null> {
    const override = await this.prisma.discordManagedRoleOverride.findUnique({
      where: { userId },
      select: { roleCategory: true },
    });

    if (!override || !this.isManagedRoleCategory(override.roleCategory)) {
      return null;
    }

    return override.roleCategory;
  }

  async createOverride(
    dto: DiscordManagedRoleOverrideCreateDto,
    actorUserId?: string,
  ): Promise<DiscordManagedRoleOverride> {
    const user = await this.getKeycloakUserSnapshot(dto.userId);
    const override = await this.prisma.discordManagedRoleOverride.upsert({
      where: { userId: dto.userId },
      create: {
        userId: dto.userId,
        userEmail: user.email,
        userDisplayName: user.displayName,
        roleCategory: dto.roleCategory,
        reason: this.normalizeOptionalText(dto.reason),
        createdById: actorUserId,
        updatedById: actorUserId,
      },
      update: {
        userEmail: user.email,
        userDisplayName: user.displayName,
        roleCategory: dto.roleCategory,
        reason: this.normalizeOptionalText(dto.reason),
        updatedById: actorUserId,
      },
    });

    return this.mapOverride(override);
  }

  async updateOverride(
    id: string,
    dto: DiscordManagedRoleOverrideUpdateDto,
    actorUserId?: string,
  ): Promise<DiscordManagedRoleOverride> {
    await this.ensureOverrideExists(id);
    const override = await this.prisma.discordManagedRoleOverride.update({
      where: { id },
      data: {
        ...(dto.roleCategory ? { roleCategory: dto.roleCategory } : {}),
        ...(dto.reason === undefined ? {} : { reason: this.normalizeOptionalText(dto.reason) }),
        updatedById: actorUserId,
      },
    });

    return this.mapOverride(override);
  }

  async deleteOverride(id: string): Promise<{ deleted: true; id: string; userId: string }> {
    const override = await this.ensureOverrideExists(id);
    await this.prisma.discordManagedRoleOverride.delete({ where: { id } });

    return { deleted: true, id, userId: override.userId };
  }

  private async ensureOverrideExists(id: string): Promise<OverrideRecord> {
    const override = await this.prisma.discordManagedRoleOverride.findUnique({
      where: { id },
    });

    if (!override) {
      throw new NotFoundException('Discord managed role override not found');
    }

    return override;
  }

  private async getKeycloakUserSnapshot(userId: string): Promise<{ email?: string; displayName?: string }> {
    const user = await this.keycloakService.getUserBasicInfo(userId);

    if (!user) {
      return {};
    }

    return {
      email: user.email,
      displayName: this.getDisplayName(user),
    };
  }

  private getDisplayName(user: KeycloakUserData): string | undefined {
    const fullName =
      user.attributes?.['fullName']?.[0] ?? [user.firstName, user.lastName].filter(Boolean).join(' ').trim();

    return fullName || user.email || user.username || user.id;
  }

  private mapOverride(override: OverrideRecord): DiscordManagedRoleOverride {
    const category = this.isManagedRoleCategory(override.roleCategory) ? override.roleCategory : 'visitor';
    const role = DISCORD_MANAGED_ROLES[category];

    return {
      id: override.id,
      userId: override.userId,
      userEmail: override.userEmail ?? undefined,
      userDisplayName: override.userDisplayName ?? undefined,
      roleCategory: category,
      roleLabel: MANAGED_ROLE_DESCRIPTIONS[category].label,
      roleId: role.roleId,
      roleName: role.roleName,
      reason: override.reason ?? undefined,
      createdAt: override.createdAt.toISOString(),
      createdById: override.createdById ?? undefined,
      updatedAt: override.updatedAt.toISOString(),
      updatedById: override.updatedById ?? undefined,
    };
  }

  private isManagedRoleCategory(value: string): value is DiscordManagedRoleCategory {
    return value === 'student' || value === 'unesp' || value === 'visitor';
  }

  private normalizeOptionalText(value: string | undefined): string | undefined {
    const normalized = value?.trim();
    return normalized ? normalized : undefined;
  }
}
