import { BadRequestException, Injectable } from '@nestjs/common';
import type { DiscordServerSettings } from '@prisma/client';
import { ServerSettingDto, UpdateServerSettingDto } from '../dto/server-settings.dto';
import { PrismaService } from '../../prisma/prisma.service';

const STUDENT_INVITE_LINK_SETTING = 'student_invite_link';
const SUPPORTED_SETTING_KEYS = new Set([STUDENT_INVITE_LINK_SETTING]);

@Injectable()
export class DiscordSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Get server setting by key
   */
  async getServerSetting(key: string): Promise<string | null> {
    const setting = await this.prisma.discordServerSettings.findUnique({
      where: { settingKey: key },
    });
    if (!setting?.settingValue) {
      return null;
    }

    try {
      return this.normalizeSettingValue(key, setting.settingValue);
    } catch (error) {
      if (error instanceof BadRequestException) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Update server setting
   */
  async updateServerSetting(key: string, dto: UpdateServerSettingDto): Promise<ServerSettingDto> {
    if (!SUPPORTED_SETTING_KEYS.has(key)) {
      throw new BadRequestException('Unsupported Discord server setting.');
    }

    const settingValue = this.normalizeSettingValue(key, dto.value);
    const setting = await this.prisma.discordServerSettings.upsert({
      where: { settingKey: key },
      update: { settingValue },
      create: {
        settingKey: key,
        settingValue,
        description: this.getSettingDescription(key),
      },
    });

    return this.toServerSettingDto(setting);
  }

  /**
   * Get all server settings
   */
  async getAllServerSettings(): Promise<ServerSettingDto[]> {
    const settings = await this.prisma.discordServerSettings.findMany();
    return settings.map((setting) => this.toServerSettingDto(setting));
  }

  private getSettingDescription(key: string): string {
    const descriptions: Record<string, string> = {
      student_invite_link: 'Convite para estudantes',
    };
    return descriptions[key] || 'Configurações do servidor de Discord';
  }

  private normalizeSettingValue(key: string, value: string): string {
    const normalized = value.trim();
    if (key !== STUDENT_INVITE_LINK_SETTING) {
      return normalized;
    }

    let url: URL;
    try {
      url = new URL(normalized);
    } catch {
      throw new BadRequestException('Discord invite link must be a valid absolute URL.');
    }

    const isDiscordShortLink = url.hostname === 'discord.gg' && /^\/[A-Za-z0-9-]+\/?$/.test(url.pathname);
    const isDiscordInviteLink =
      (url.hostname === 'discord.com' || url.hostname === 'www.discord.com') &&
      /^\/invite\/[A-Za-z0-9-]+\/?$/.test(url.pathname);

    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.hash ||
      (!isDiscordShortLink && !isDiscordInviteLink)
    ) {
      throw new BadRequestException('Discord invite link must use an official HTTPS Discord invite URL.');
    }

    return url.toString();
  }

  private toServerSettingDto(setting: DiscordServerSettings): ServerSettingDto {
    return {
      id: setting.id,
      key: setting.settingKey,
      value: setting.settingValue,
      description: setting.description ?? '',
      updatedAt: setting.updatedAt,
    };
  }
}
