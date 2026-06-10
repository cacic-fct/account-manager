import { Injectable } from '@nestjs/common';
import type { Prisma, PrivacySetting } from '@prisma/client';
import {
  PrivacySettings,
  PRIVACY_SETTING_TYPES,
  PrivacySettingTypeValue,
} from './constants/privacy-setting.constants';
import {
  UpdatePrivacySettingDto,
  BulkUpdatePrivacySettingsDto,
  PrivacySettingResponseDto,
} from './dto/privacy-setting.dto';
import { PrismaService } from '../prisma/prisma.service';

type PrivacySettingRecord = Omit<PrivacySetting, 'settings' | 'metadata'> & {
  settings: PrivacySettings;
  metadata?: Record<string, any>;
};

@Injectable()
export class PrivacyService {
  constructor(private readonly prisma: PrismaService) {}

  private getDefaultSettings(): PrivacySettings {
    return {
      analytics_tracking: true,
      error_debugging: true,
      performance_monitoring: true,
      cookie_banner_accepted: false,
    };
  }

  private getDefaultMetadata(): Record<string, string> {
    return {
      source: 'default_creation',
      createdAt: new Date().toISOString(),
    };
  }

  private normalizeSettings(value: unknown): PrivacySettings {
    const defaults = this.getDefaultSettings();

    if (!value || typeof value !== 'object') {
      return defaults;
    }

    const record = value as Record<string, unknown>;
    return {
      analytics_tracking:
        typeof record.analytics_tracking === 'boolean'
          ? record.analytics_tracking
          : defaults.analytics_tracking,
      error_debugging:
        typeof record.error_debugging === 'boolean'
          ? record.error_debugging
          : defaults.error_debugging,
      performance_monitoring:
        typeof record.performance_monitoring === 'boolean'
          ? record.performance_monitoring
          : defaults.performance_monitoring,
      cookie_banner_accepted:
        typeof record.cookie_banner_accepted === 'boolean'
          ? record.cookie_banner_accepted
          : defaults.cookie_banner_accepted,
    };
  }

  private normalizeMetadata(value: unknown): Record<string, any> | undefined {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    return value as Record<string, any>;
  }

  private toRecord(setting: PrivacySetting): PrivacySettingRecord {
    return {
      ...setting,
      settings: this.normalizeSettings(setting.settings),
      metadata: this.normalizeMetadata(setting.metadata),
    };
  }

  /**
   * Get privacy settings for a user, creating defaults if they don't exist
   */
  async getUserPrivacySettings(userId: string): Promise<PrivacySettingRecord> {
    const userSettings = await this.prisma.privacySetting.upsert({
      where: { userId },
      create: {
        userId,
        settings: this.getDefaultSettings() as unknown as Prisma.InputJsonValue,
        metadata: this.getDefaultMetadata(),
      },
      update: {},
    });

    return this.toRecord(userSettings);
  }

  /**
   * Update a specific privacy setting for a user
   */
  async updatePrivacySetting(
    userId: string,
    settingType: PrivacySettingTypeValue,
    updateData: UpdatePrivacySettingDto,
  ): Promise<PrivacySettingRecord> {
    const userSettings = await this.getUserPrivacySettings(userId);
    const currentSettings = userSettings.settings;

    currentSettings[settingType] = updateData.enabled;

    let metadata: Record<string, unknown> = userSettings.metadata ?? {};

    if (updateData.metadata) {
      metadata = {
        ...metadata,
        [`${settingType}_metadata`]: updateData.metadata,
        lastUpdated: new Date().toISOString(),
      };
    }

    const updated = await this.prisma.privacySetting.update({
      where: { id: userSettings.id },
      data: {
        settings: currentSettings as unknown as Prisma.InputJsonValue,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toRecord(updated);
  }

  /**
   * Bulk update multiple privacy settings for a user
   */
  async bulkUpdatePrivacySettings(
    userId: string,
    updateData: BulkUpdatePrivacySettingsDto,
  ): Promise<PrivacySettingRecord> {
    const userSettings = await this.getUserPrivacySettings(userId);
    const settings = userSettings.settings;
    let metadata: Record<string, unknown> = userSettings.metadata ?? {};

    const settingTypes = Object.keys(updateData) as PrivacySettingTypeValue[];
    for (const settingType of settingTypes) {
      const setting = updateData[settingType];
      if (setting) {
        settings[settingType] = setting.enabled;

        if (setting.metadata) {
          metadata = {
            ...metadata,
            [`${settingType}_metadata`]: setting.metadata,
          };
        }
      }
    }

    metadata = {
      ...metadata,
      lastBulkUpdate: new Date().toISOString(),
    };

    const updated = await this.prisma.privacySetting.update({
      where: { id: userSettings.id },
      data: {
        settings: settings as unknown as Prisma.InputJsonValue,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });
    return this.toRecord(updated);
  }

  /**
   * Get a specific privacy setting value
   */
  async getUserPrivacySetting(
    userId: string,
    settingType: PrivacySettingTypeValue,
  ): Promise<boolean> {
    const userSettings = await this.getUserPrivacySettings(userId);
    return userSettings.settings[settingType];
  }

  /**
   * Get simplified privacy preferences (for external consumption)
   */
  async getSimplifiedPreferences(
    userId: string,
  ): Promise<Record<string, boolean>> {
    const userSettings = await this.getUserPrivacySettings(userId);
    return { ...userSettings.settings };
  }

  /**
   * Check if cookie banner should be displayed
   */
  async shouldShowCookieBanner(userId: string): Promise<boolean> {
    const cookieAccepted = await this.getUserPrivacySetting(
      userId,
      PRIVACY_SETTING_TYPES.COOKIE_BANNER_ACCEPTED,
    );
    return !cookieAccepted;
  }

  /**
   * Mark cookie banner as accepted
   */
  async acceptCookieBanner(userId: string): Promise<PrivacySettingRecord> {
    return this.updatePrivacySetting(
      userId,
      PRIVACY_SETTING_TYPES.COOKIE_BANNER_ACCEPTED,
      {
        enabled: true,
        metadata: {
          acceptedAt: new Date(),
          source: 'cookie_banner',
        },
      },
    );
  }

  /**
   * Initialize default privacy settings for a user
   */
  async initializeUserPrivacySettings(
    userId: string,
  ): Promise<PrivacySettingRecord> {
    return this.getUserPrivacySettings(userId);
  }

  /**
   * Get privacy settings by user ID (for API access)
   */
  async getSettingsByUserId(
    userId: number,
  ): Promise<PrivacySettingResponseDto> {
    const settings = await this.getUserPrivacySettings(userId.toString());
    return {
      id: settings.id,
      userId: settings.userId,
      settings: settings.settings,
      metadata: settings.metadata,
      createdAt: settings.createdAt,
      updatedAt: settings.updatedAt,
    };
  }

  async getUserSettings(userId: string): Promise<PrivacySettingRecord> {
    return this.getUserPrivacySettings(userId);
  }

  async getUserSetting(
    userId: string,
    settingType: PrivacySettingTypeValue,
  ): Promise<boolean> {
    return this.getUserPrivacySetting(userId, settingType);
  }

  async getCookieConsent(userId: string): Promise<{
    hasConsent: boolean;
    consentDate: Date | null;
  }> {
    const userSettings = await this.getUserPrivacySettings(userId);
    const hasConsent = userSettings.settings.cookie_banner_accepted;
    const consentDate = hasConsent ? userSettings.updatedAt : null;

    return { hasConsent, consentDate };
  }

  async recordCookieConsent(userId: string): Promise<void> {
    await this.acceptCookieBanner(userId);
  }

  async bulkUpdateSettings(
    userId: string,
    settings: {
      settingType: PrivacySettingTypeValue;
      enabled: boolean;
      metadata?: Record<string, any>;
    }[],
  ): Promise<number> {
    const userSettings = await this.getUserPrivacySettings(userId);
    const currentSettings = userSettings.settings;
    let metadata: Record<string, unknown> = userSettings.metadata ?? {};
    let updatedCount = 0;

    for (const setting of settings) {
      currentSettings[setting.settingType] = setting.enabled;

      if (setting.metadata) {
        metadata = {
          ...metadata,
          [`${setting.settingType}_metadata`]: setting.metadata,
        };
      }

      updatedCount++;
    }

    metadata = {
      ...metadata,
      lastBulkUpdate: new Date().toISOString(),
    };

    await this.prisma.privacySetting.update({
      where: { id: userSettings.id },
      data: {
        settings: currentSettings as unknown as Prisma.InputJsonValue,
        metadata: metadata as unknown as Prisma.InputJsonValue,
      },
    });

    return updatedCount;
  }
}
