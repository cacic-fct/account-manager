import { Injectable, Logger } from '@nestjs/common';
import type { DiscordLink } from '@prisma/client';
import { DiscordRoleService } from './discord-role.service';
import { isUndergraduateStudentRole } from '@cacic/shared-types';
import { isUnespEmail } from '@cacic/shared-utils';

const DISCORD_METADATA_KEYS = {
  CS_STUDENT_ELIGIBLE: 'is_eligible_for_cs_student',
  UNESP_ELIGIBLE: 'is_eligible_for_unesp',
  EXTERNAL_ELIGIBLE: 'is_eligible_for_external',
} as const;

@Injectable()
export class DiscordMetadataService {
  private readonly logger = new Logger(DiscordMetadataService.name);

  constructor(private readonly discordRoleService: DiscordRoleService) {}

  async pushUserMetadataToDiscord(
    discordLink: DiscordLink,
    accessToken: string,
  ): Promise<void> {
    const user = await this.discordRoleService.getUserByKeycloakId(
      discordLink.userId,
    );

    const clientId = process.env.DISCORD_CLIENT_ID;

    if (!clientId) {
      throw new Error('Discord client ID not configured');
    }

    const url = `https://discord.com/api/v10/users/@me/applications/${clientId}/role-connection`;

    const hasUnespEmail = isUnespEmail(user?.email);

    const isStudent = user?.unespRole
      ? isUndergraduateStudentRole(user.unespRole)
      : false;

    const isCSStudent =
      this.discordRoleService.checkEnrollmentPattern(user?.enrollmentNumber) ??
      false;

    const isVerified = user?.unespRoleVerified ?? false;

    const isEligibleForCSStudent =
      hasUnespEmail && isVerified && isStudent && isCSStudent;

    const isEligibleForUnesp = hasUnespEmail && !isEligibleForCSStudent;

    const isEligibleForExternal = !hasUnespEmail;

    const body = {
      platform_name: 'CACiC SSO',
      metadata: {
        [DISCORD_METADATA_KEYS.CS_STUDENT_ELIGIBLE]: isEligibleForCSStudent
          ? '1'
          : '0',
        [DISCORD_METADATA_KEYS.UNESP_ELIGIBLE]: isEligibleForUnesp ? '1' : '0',
        [DISCORD_METADATA_KEYS.EXTERNAL_ELIGIBLE]: isEligibleForExternal
          ? '1'
          : '0',
      },
    };

    const response = await fetch(url, {
      method: 'PUT',
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Error pushing Discord metadata: ${response.status} ${errorText}`,
      );
    }
  }

  async registerApplicationMetadata(): Promise<void> {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;

    if (!clientId || !botToken) {
      throw new Error('Discord client ID or bot token not configured');
    }

    const metadata = [
      {
        key: DISCORD_METADATA_KEYS.CS_STUDENT_ELIGIBLE,
        name: 'CS Student Eligible',
        description: 'Elegível como estudante de Ciência da Computação',
        type: 7,
      },
      {
        key: DISCORD_METADATA_KEYS.UNESP_ELIGIBLE,
        name: 'Unesp Eligible',
        description: 'Elegível como estudante da Unesp',
        type: 7,
      },
      {
        key: DISCORD_METADATA_KEYS.EXTERNAL_ELIGIBLE,
        name: 'External User Eligible',
        description: 'Elegível como usuário externo (sem email da Unesp)',
        type: 7,
      },
    ];

    const response = await fetch(
      `https://discord.com/api/v10/applications/${clientId}/role-connections/metadata`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bot ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(metadata),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();

      throw new Error(
        `Failed to register Discord metadata: ${response.status} ${errorText}`,
      );
    }

    this.logger.log('Discord application metadata registered successfully');
  }
}
