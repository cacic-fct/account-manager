import { Injectable, Logger } from '@nestjs/common';
import { Context, On, Once, ContextOf } from 'necord';
import { DiscordBotService } from './discord-bot.service';
import { DiscordClientService } from './services/discord-client.service';

@Injectable()
export class DiscordEventsService {
  private readonly logger = new Logger(DiscordEventsService.name);

  constructor(
    private discordBotService: DiscordBotService,
    private discordClientService: DiscordClientService,
  ) {}

  @Once('ready')
  public onReady(@Context() [client]: ContextOf<'ready'>) {
    this.logger.log(`Bot logged in as ${client.user.username}`);
    this.logger.log(`Guild count: ${client.guilds.cache.size}`);

    // Set the client in our service for dependency injection
    this.discordClientService.setClient(client);
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
      this.logger.error(
        `Failed to assign nickname for ${member.user.username}: ${error}`,
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
        this.logger.error(
          `Failed to assign nickname for ${member.user.username}: ${error}`,
        );
      }
    }
  }

  @On('guildMemberUpdate')
  public onGuildMemberUpdate(
    @Context() [, newMember]: ContextOf<'guildMemberUpdate'>,
  ) {
    // Handle member updates if needed
    this.logger.log(
      `Member updated: ${newMember.user.username} (${newMember.id})`,
    );
  }
}
