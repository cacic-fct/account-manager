import { Injectable } from '@nestjs/common';
import type { DiscordServerSettings } from '@prisma/client';
import {
  ServerSettingDto,
  UpdateServerSettingDto,
} from '../dto/server-settings.dto';
import { PrismaService } from '../../prisma/prisma.service';

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
    return setting?.settingValue || null;
  }

  /**
   * Update server setting
   */
  async updateServerSetting(
    key: string,
    dto: UpdateServerSettingDto,
  ): Promise<ServerSettingDto> {
    const setting = await this.prisma.discordServerSettings.upsert({
      where: { settingKey: key },
      update: { settingValue: dto.value },
      create: {
        settingKey: key,
        settingValue: dto.value,
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
