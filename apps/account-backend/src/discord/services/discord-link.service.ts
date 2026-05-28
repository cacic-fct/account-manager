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
import { DiscordMetadataService } from './discord-metadata.service';
import { DiscordSettingsService } from './discord-settings.service';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class DiscordLinkService {
  private readonly logger = new Logger(DiscordLinkService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly discordOAuthService: DiscordOAuthService,
    private readonly discordRoleService: DiscordRoleService,
    private readonly discordMetadataService: DiscordMetadataService,
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
      where: { discordId: discordUser.id, userId, deleted: true },
    });

    let discordLink: DiscordLink;

    if (existingSoftDeletedLink) {
      discordLink = await this.prisma.discordLink.update({
        where: { id: existingSoftDeletedLink.id },
        data: {
          deleted: false,
          deletedAt: null,
          discordUsername: discordUser.username,
          discordGlobalName: discordUser.global_name || discordUser.username,
          discordAvatarHash: discordUser.avatar,
          isVerified: true,
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
      await this.discordRoleService.assignUserRole(discordLink);
    } catch (error) {
      this.logger.error('Failed to assign Discord role', error);
    }

    try {
      await this.discordMetadataService.pushUserMetadataToDiscord(
        discordLink,
        tokenResponse.access_token,
      );
    } catch (error) {
      this.logger.error('Failed to push metadata to Discord', error);
    }

    return this.toDto(discordLink);
  }

  async getDiscordLinkStatus(userId: string): Promise<DiscordLinkStatusDto> {
    const discordLinks = await this.prisma.discordLink.findMany({
      where: { userId, deleted: false },
    });

    const eligibleForRole =
      await this.discordRoleService.checkRoleEligibility(userId);

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

    await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: {
        deleted: true,
        deletedAt: new Date(),
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

    return await this.prisma.discordLink.update({
      where: { id: discordLink.id },
      data: {
        deleted: false,
        deletedAt: null,
      },
    });
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
