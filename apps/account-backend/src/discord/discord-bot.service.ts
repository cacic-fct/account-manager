import { Injectable, Logger } from '@nestjs/common';
import { Client, Guild, GuildMember } from 'discord.js';
import type { DiscordLink } from '@prisma/client';
import { UserService } from '../auth/services/user.service';
import { PrismaService } from '../prisma/prisma.service';
import { DiscordRoleService } from './services/discord-role.service';

@Injectable()
export class DiscordBotService {
  private readonly logger = new Logger(DiscordBotService.name);

  constructor(
    private readonly prisma: PrismaService,
    private userService: UserService,
    private readonly discordRoleService: DiscordRoleService,
  ) {}

  async assignNickname(member: GuildMember, newNickname: string | null): Promise<void> {
    const client = member.client;
    const guildId = member.guild.id;
    const discordUserId = member.id;

    try {
      const guild = await this.getGuild(client, guildId);
      if (!guild) {
        this.logger.warn(`Guild not found: ${guildId}`);
        return;
      }

      const member = await guild.members.fetch(discordUserId);
      if (!member) {
        this.logger.warn(`Member not found: ${discordUserId}`);
        return;
      }

      const discordLink = await this.prisma.discordLink.findFirst({
        where: { discordId: member.id, deleted: false },
      });
      if (!discordLink) {
        this.logger.debug(`No Discord link found for user: ${discordUserId}`);
        return;
      }

      const user = await this.userService.findByKeycloakId(discordLink.userId);
      if (!user) {
        this.logger.warn(`No user found for Discord link: ${discordLink.id}`);
        return;
      }

      if (newNickname) {
        const nameParts = newNickname.split(' ').map((part) => part.toLowerCase());
        const fullnameParts = user.fullname.split(' ').map((part) => part.toLowerCase());
        const matchingNames = nameParts.filter((part) => fullnameParts.includes(part));

        if (matchingNames.length >= 2) {
          this.logger.log(
            `Skipping nickname assignment for ${member.user.username} as new nickname contains matching names: ${matchingNames.join(', ')}`,
          );
          return;
        }
      }

      let nickname: string;

      if (user.fullname.length <= 32) {
        nickname = user.fullname;
      } else if (user.displayName.length <= 32) {
        nickname = user.displayName;
      } else if (user.fullname) {
        const names = user.fullname.split(' ');
        const firstName = names[0];
        const lastName = names[names.length - 1];
        nickname = `${firstName} ${lastName}`;
      } else if (user.displayName) {
        const names = user.displayName.split(' ');
        const firstName = names[0];
        const lastName = names[names.length - 1];
        nickname = `${firstName} ${lastName}`;
      } else {
        return;
      }

      await member.setNickname(nickname);

      this.logger.log(`Set nickname for ${member.user.username}: ${nickname}`);
    } catch (error) {
      this.logger.error(`Failed to set nickname for user ${discordUserId}:`, error);
    }
  }

  async assignRoleAndNickname(
    client: Client,
    guildId: string,
    discordUserId: string,
    discordLink: DiscordLink,
  ): Promise<void> {
    try {
      const user = await this.userService.findByKeycloakId(discordLink.userId);
      if (!user) {
        this.logger.warn(`No user found for Discord link: ${discordLink.id}`);
        return;
      }

      const guild = await this.getGuild(client, guildId);
      if (!guild) {
        this.logger.warn(`Guild not found: ${guildId}`);
        return;
      }

      const member = await guild.members.fetch(discordUserId);
      if (!member) {
        this.logger.warn(`Member not found: ${discordUserId}`);
        return;
      }

      const nickname = user.fullname || user.displayName || user.email.split('@')[0];
      try {
        await member.setNickname(nickname);
        this.logger.log(`Set nickname for ${member.user.username}: ${nickname}`);
      } catch (error) {
        this.logger.error(`Failed to set nickname for ${member.user.username}:`, error);
      }

      await this.discordRoleService.assignUserRole(discordLink, {
        client,
        guildId,
        discordUserId,
        member,
        reason: 'discord-link-or-join-sync',
      });
    } catch (error) {
      this.logger.error(`Error in assignRoleAndNickname:`, error);
    }
  }

  async removeUserFromGuild(client: Client, guildId: string, discordUserId: string): Promise<void> {
    try {
      const guild = await this.getGuild(client, guildId);
      if (!guild) {
        this.logger.warn(`Guild not found: ${guildId}`);
        return;
      }

      const member = await guild.members.fetch(discordUserId);
      if (member) {
        await member.kick('Account deleted from CACiC system');
        this.logger.log(`Removed user ${member.user.username} from guild due to account deletion`);
      }
    } catch (error) {
      this.logger.error(`Error removing user from guild:`, error);
    }
  }

  async handleMemberJoin(member: GuildMember): Promise<void> {
    this.logger.log(`New member joined: ${member.user.username} (${member.id})`);

    const discordLink = await this.prisma.discordLink.findFirst({
      where: { discordId: member.id, deleted: false },
    });

    if (discordLink && member.client) {
      await this.assignRoleAndNickname(member.client, member.guild.id, member.id, discordLink);
    } else {
      await this.discordRoleService.ensureRegistrationRoleForMember(
        member,
        'discord-member-joined-without-linked-account',
      );
      this.logger.debug(`No CACiC Discord link found for joined member ${member.id}; registration role ensured`);
    }
  }

  private async getGuild(client: Client, guildId: string): Promise<Guild> {
    return await client.guilds.fetch(guildId);
  }
}
