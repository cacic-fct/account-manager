import {
  Controller,
  Get,
  Post,
  Body,
  Param,
  UseGuards,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiParam,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { M2MGuard, M2MProtected, RequireRoles } from '../auth/jwt/m2m.guard';
import { PrivacyService } from './privacy.service';
import {
  PRIVACY_SETTING_TYPES,
  PrivacySettingTypeValue,
} from './constants/privacy-setting.constants';
import {
  ApiPrivacySettingResponseDto,
  BulkPrivacySettingsDto,
} from './dto/privacy-setting.dto';

@ApiTags('External API - Privacy Settings')
@Controller('v1/privacy')
@UseGuards(M2MGuard)
@M2MProtected()
@RequireRoles('privacy:read')
@ApiBearerAuth()
export class PrivacyApiController {
  constructor(private readonly privacyService: PrivacyService) {}

  @Get('user/:userId/settings')
  @ApiOperation({
    summary: 'Get user privacy settings',
    description:
      'Retrieve all privacy settings for a specific user. Requires M2M authentication with privacy:read realm role.',
  })
  @ApiResponse({
    status: 200,
    description: 'User privacy settings retrieved successfully',
    type: [ApiPrivacySettingResponseDto],
  })
  @ApiResponse({
    status: 404,
    description: 'User not found',
  })
  async getUserPrivacySettings(
    @Param('userId') userId: string,
  ): Promise<ApiPrivacySettingResponseDto[]> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const userSettings = await this.privacyService.findUserSettings(userId);

    if (!userSettings) {
      throw new NotFoundException('User not found or has no privacy settings');
    }

    // Convert JSONB settings to API format
    const settings = userSettings.settings;
    return Object.entries(settings).map(([settingType, enabled]) => ({
      settingType: settingType as PrivacySettingTypeValue,
      enabled: Boolean(enabled),
      lastUpdated: userSettings.updatedAt,
    }));
  }

  @Get('user/:userId/setting/:settingType')
  @ApiOperation({
    summary: 'Get specific privacy setting',
    description:
      'Retrieve a specific privacy setting for a user. Requires M2M authentication with privacy:read realm role.',
  })
  @ApiParam({
    name: 'settingType',
    description: 'Type of privacy setting to retrieve',
    schema: {
      type: 'string',
      enum: [
        'analytics_tracking',
        'error_debugging',
        'performance_monitoring',
        'cookie_banner_accepted',
      ],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy setting retrieved successfully',
    type: ApiPrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 404,
    description: 'Setting not found',
  })
  async getSpecificPrivacySetting(
    @Param('userId') userId: string,
    @Param('settingType') settingType: string,
  ): Promise<ApiPrivacySettingResponseDto> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    if (
      !Object.values(PRIVACY_SETTING_TYPES).includes(
        settingType as PrivacySettingTypeValue,
      )
    ) {
      throw new BadRequestException('Invalid setting type');
    }

    const userSettings = await this.privacyService.findUserSettings(userId);

    if (!userSettings) {
      throw new NotFoundException('User privacy settings not found');
    }

    const settings = userSettings.settings;
    const enabled = Boolean(settings[settingType as PrivacySettingTypeValue]);

    return {
      settingType: settingType as PrivacySettingTypeValue,
      enabled,
      lastUpdated: userSettings.updatedAt,
    };
  }

  @Get('user/:userId/cookie-consent')
  @ApiOperation({
    summary: 'Check cookie consent status',
    description:
      'Check if user has given cookie consent. Requires M2M authentication with privacy:read realm role.',
  })
  @ApiResponse({
    status: 200,
    description: 'Cookie consent status retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        hasConsent: { type: 'boolean' },
        consentDate: { type: 'string', format: 'date-time', nullable: true },
      },
    },
  })
  async getCookieConsentStatus(
    @Param('userId') userId: string,
  ): Promise<{ hasConsent: boolean; consentDate: Date | null }> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const userSettings = await this.privacyService.findUserSettings(userId);

    if (!userSettings) {
      throw new NotFoundException('User privacy settings not found');
    }

    return {
      hasConsent: userSettings.settings.cookie_banner_accepted,
      consentDate: userSettings.settings.cookie_banner_accepted
        ? userSettings.updatedAt
        : null,
    };
  }

  @Post('user/:userId/cookie-consent')
  @ApiOperation({
    summary: 'Record cookie consent',
    description:
      'Record that user has given cookie consent. Requires M2M authentication with privacy:write realm role.',
  })
  @RequireRoles('privacy:write')
  @ApiResponse({
    status: 200,
    description: 'Cookie consent recorded successfully',
  })
  async recordCookieConsent(
    @Param('userId') userId: string,
  ): Promise<{ success: boolean }> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    await this.privacyService.recordCookieConsent(userId);

    return { success: true };
  }

  @Post('user/:userId/settings/bulk')
  @ApiOperation({
    summary: 'Bulk update privacy settings',
    description:
      'Update multiple privacy settings at once. Requires M2M authentication with privacy:write realm role.',
  })
  @RequireRoles('privacy:write')
  @ApiResponse({
    status: 200,
    description: 'Privacy settings updated successfully',
  })
  async bulkUpdateSettings(
    @Param('userId') userId: string,
    @Body() settingsDto: BulkPrivacySettingsDto,
  ): Promise<{ success: boolean; updated: number }> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const updated = await this.privacyService.bulkUpdateSettings(
      userId,
      settingsDto.settings,
    );

    return { success: true, updated };
  }
}
