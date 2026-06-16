import {
  Injectable,
  BadRequestException,
  NotFoundException,
  Logger,
} from '@nestjs/common';
import type { DiscordLink } from '@prisma/client';
import {
  DiscordLinkDto,
  LinkDiscordRequestDto,
  DiscordLinkStatusDto,
} from '../dto/discord-link.dto';
import { DiscordOAuthService } from './discord-oauth.service';
import { DiscordRoleService } from './discord-role.service';
import { DiscordSettingsService } from './discord-settings.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DiscordLinkService {
  private readonly logger = new Logger(DiscordLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordOAuthService: DiscordOAuthService,
    private readonly discordRoleService: DiscordRoleService,
    private readonly discordSettingsService: DiscordSettingsService,
  ) {}

  async linkDiscordAccount(
    userId: string,
    dto: LinkDiscordRequestDto,
  ): Promise<DiscordLinkDto> {
    const tokenResponse = await this.discordOAuthService.exchangeCodeForToken(
      dto.code,
    );

    const discordUser = await this.discordOAuthService.getDiscordUserInfo(
      tokenResponse.access_token,
    );

    const existingActiveLink = await this.prisma.discordLink.findFirst({
      where: { discordId: discordUser.id, deleted: false },
    });

    if (existingActiveLink && existingActiveLink.userId !== userId) {
      throw new BadRequestException(
        'This Discord account is already linked to another user',
      );
    }

    const existingSoftDeletedLink = await this.prisma.discordLink.findFirst({
      where: { discordId: discordUser.id, deleted: true },
    });

    let discordLink: DiscordLink;

    if (existingSoftDeletedLink) {
      discordLink = await this.prisma.discordLink.update({
        where: { id: existingSoftDeletedLink.id },
        data: {
          userId,
          deleted: false,
          deletedAt: null,
          discordUsername: discordUser.username,
          discordGlobalName: discordUser.global_name || discordUser.username,
          discordAvatarHash: discordUser.avatar,
          isVerified: true,
          serverInviteUsed: null,
          assignedRole: null,
        },
      });
    } else if (existingActiveLink && existingActiveLink.userId === userId) {
      discordLink = existingActiveLink;
    } else {
      discordLink = await this.prisma.discordLink.create({
        data: {
          userId,
          discordId: discordUser.id,
          discordUsername: discordUser.username,
          discordGlobalName: discordUser.global_name || discordUser.username,
          discordAvatarHash: discordUser.avatar,
          isVerified: true,
        },
      });
    }

    try {
      await this.discordRoleService.assignUserRole(discordLink, {
        reason: 'discord-account-linked',
      });
    } catch (error) {
      this.logger.error('Failed to assign Discord role', error);
    }

    return this.toDto(discordLink);
  }

  async getDiscordLinkStatus(userId: string): Promise<DiscordLinkStatusDto> {
    let discordLinks = await this.prisma.discordLink.findMany({
      where: { userId, deleted: false },
    });

    const eligibleForRole =
      await this.discordRoleService.checkRoleEligibility(userId);

    if (discordLinks.some((link) => link.isVerified)) {
      try {
        await this.discordRoleService.syncUserDiscordRoles(
          userId,
          'discord-status-refresh',
        );
        discordLinks = await this.prisma.discordLink.findMany({
          where: { userId, deleted: false },
        });
      } catch (error) {
        this.logger.warn('Failed to refresh Discord managed role status', {
          userId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    let inviteLink: string | undefined;
    if (
      discordLinks.length > 0 &&
      discordLinks.some((link) => link.isVerified) &&
      eligibleForRole === 'student'
    ) {
      const linkValue = await this.discordSettingsService.getServerSetting(
        'student_invite_link',
      );
      inviteLink = linkValue || undefined;
    }

    return {
      isLinked:
        discordLinks.length > 0 && discordLinks.some((link) => link.isVerified),
      discordLinks: discordLinks.map((link) => this.toDto(link)),
      inviteLink,
      eligibleForRole,
    };
  }

  async unlinkDiscordAccount(userId: string, linkId: string): Promise<void> {
    const discordLink = await this.prisma.discordLink.findFirst({
      where: { id: linkId, userId, deleted: false },
    });

    if (!discordLink) {
      throw new NotFoundException('No Discord link found for this user');
    }

    try {
      await this.discordRoleService.removeManagedRolesForDiscordLink(
        discordLink,
      );
    } catch (error) {
      this.logger.warn('Failed to remove Discord managed roles on unlink', {
        linkId: discordLink.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: {
        deleted: true,
        deletedAt: new Date(),
        assignedRole: null,
      },
    });
  }

  async getDiscordLinkByDiscordId(
    discordId: string,
  ): Promise<DiscordLink | null> {
    return await this.prisma.discordLink.findFirst({
      where: { discordId, deleted: false },
    });
  }

  async getAllDiscordLinksForUser(
    userId: string,
    includeDeleted: boolean = false,
  ): Promise<DiscordLink[]> {
    return await this.prisma.discordLink.findMany({
      where: includeDeleted ? { userId } : { userId, deleted: false },
      orderBy: { createdAt: 'desc' },
    });
  }

  async restoreDiscordLink(linkId: string): Promise<DiscordLink> {
    const discordLink = await this.prisma.discordLink.findFirst({
      where: { id: linkId, deleted: true },
    });

    if (!discordLink) {
      throw new NotFoundException('No deleted Discord link found with this ID');
    }

    const existingActiveLink = await this.prisma.discordLink.findFirst({
      where: { discordId: discordLink.discordId, deleted: false },
    });

    if (existingActiveLink) {
      throw new BadRequestException(
        'This Discord account is currently linked to another user',
      );
    }

    const restoredLink = await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: {
        deleted: false,
        deletedAt: null,
      },
    });

    try {
      await this.discordRoleService.assignUserRole(restoredLink, {
        reason: 'discord-link-restored',
      });
    } catch (error) {
      this.logger.warn('Failed to assign Discord role after restoring link', {
        linkId: restoredLink.id,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }

    return restoredLink;
  }

  private toDto(discordLink: DiscordLink): DiscordLinkDto {
    return {
      id: discordLink.id,
      userId: discordLink.userId,
      discordId: discordLink.discordId,
      discordUsername: discordLink.discordUsername,
      discordGlobalName: discordLink.discordGlobalName,
      discordAvatarHash: discordLink.discordAvatarHash ?? undefined,
      isVerified: discordLink.isVerified,
      assignedRole: discordLink.assignedRole ?? undefined,
      createdAt: discordLink.createdAt,
    };
  }
}
