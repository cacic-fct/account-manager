import { Injectable, Logger } from '@nestjs/common';
import { Context, On, Once, ContextOf } from 'necord';
import { Cron } from '@nestjs/schedule';
import type { GuildMember } from 'discord.js';
import { DiscordBotService } from './discord-bot.service';
import { DiscordClientService } from './services/discord-client.service';
import { DiscordRoleService } from './services/discord-role.service';

@Injectable()
export class DiscordEventsService {
  private readonly logger = new Logger(DiscordEventsService.name);

  constructor(
    private discordBotService: DiscordBotService,
    private discordClientService: DiscordClientService,
    private readonly discordRoleService: DiscordRoleService,
  ) {}

  @Once('ready')
  public onReady(@Context() [client]: ContextOf<'ready'>) {
    this.logger.log(`Bot logged in as ${client.user.username}`);
    this.logger.log(`Guild count: ${client.guilds.cache.size}`);

    // Set the client in our service for dependency injection
    this.discordClientService.setClient(client);

    void this.discordRoleService
      .syncAllLinkedMemberRoles('discord-bot-ready')
      .catch((error) => {
        this.logger.warn(
          'Failed to sync Discord managed roles on ready',
          error,
        );
      });
  }

  @On('guildMemberAdd')
  public async onGuildMemberAdd(
    @Context() [member]: ContextOf<'guildMemberAdd'>,
  ) {
    await this.discordBotService.handleMemberJoin(member);
  }

  @On('guildMemberRoleAdd')
  public async onGuildMemberRoleAdd(
    @Context() [member]: ContextOf<'guildMemberRoleAdd'>,
  ) {
    // Assign nickname when a member is added to a role
    this.logger.log(
      `Member role added: ${member.user.username} (${member.id})`,
    );
    try {
      await this.discordBotService.assignNickname(member, member.nickname);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to assign nickname for ${member.user.username}: ${message}`,
      );
    }
  }

  @On('guildMemberNicknameUpdate')
  public async onGuildMemberNicknameUpdate(
    @Context()
    [member, oldNickname, newNickname]: ContextOf<'guildMemberNicknameUpdate'>,
  ) {
    this.logger.log(
      `Member nickname updated: ${member.user.username} (${member.id}) from "${oldNickname}" to "${newNickname}"`,
    );

    // Check if the nickname has changed
    if (oldNickname !== newNickname) {
      try {
        await this.discordBotService.assignNickname(member, newNickname);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `Failed to assign nickname for ${member.user.username}: ${message}`,
        );
      }
    }
  }

  @On('guildMemberUpdate')
  public async onGuildMemberUpdate(
    @Context() [oldMember, newMember]: ContextOf<'guildMemberUpdate'>,
  ) {
    // Handle member updates if needed
    this.logger.log(
      `Member updated: ${newMember.user.username} (${newMember.id})`,
    );

    if (
      this.didRolesChange(oldMember, newMember) &&
      this.hasNoAssignableRoles(newMember)
    ) {
      await this.discordRoleService.syncGuildMemberRoleState(
        newMember,
        'discord-member-roles-cleared',
      );
    }
  }

  @Cron('*/30 * * * *')
  public async syncManagedRoles(): Promise<void> {
    await this.discordRoleService.syncAllLinkedMemberRoles(
      'scheduled-discord-managed-role-sync',
    );
  }

  @Cron('0 0 * * 0')
  public async syncGuildMemberRoleState(): Promise<void> {
    await this.discordRoleService.syncAllGuildMemberRoleState(
      'weekly-discord-guild-member-role-state-sync',
    );
  }

  private didRolesChange(
    oldMember: Pick<GuildMember, 'roles'>,
    newMember: Pick<GuildMember, 'roles'>,
  ) {
    if (oldMember.roles.cache.size !== newMember.roles.cache.size) {
      return true;
    }

    return oldMember.roles.cache.some(
      (role) => !newMember.roles.cache.has(role.id),
    );
  }

  private hasNoAssignableRoles(
    member: Pick<GuildMember, 'guild' | 'roles'>,
  ): boolean {
    return (
      member.roles.cache.filter((role) => role.id !== member.guild.id).size ===
      0
    );
  }
}
