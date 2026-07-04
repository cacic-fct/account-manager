import { Controller, Get, Post, Put, Body, Param, ParseEnumPipe, Session, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiBody } from '@nestjs/swagger';
import { PrivacyService } from './privacy.service';
import {
  UpdatePrivacySettingDto,
  BulkUpdatePrivacySettingsDto,
  PrivacySettingResponseDto,
} from './dto/privacy-setting.dto';
import { PRIVACY_SETTING_TYPES, PrivacySettingTypeValue } from './constants/privacy-setting.constants';
import { Auth } from '../auth/guards/auth.decorator';
import { CurrentUserGuard } from '../auth/guards/current-user.guard';
import { AuthSession } from '../auth/auth.controller';
import { CsrfGuard, SkipCsrf } from '../auth/csrf/csrf.guard';
import type { PrivacyUserIdentity } from './privacy.service';

@ApiTags('Privacy')
@Controller('privacy')
export class PrivacyController {
  constructor(private readonly privacyService: PrivacyService) {}

  @ApiOperation({
    summary: 'Get user privacy settings',
    description: 'Get all privacy settings for the authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy settings retrieved successfully',
    type: PrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @SkipCsrf()
  @Get('settings')
  async getUserPrivacySettings(@Session() session: AuthSession) {
    return this.privacyService.getUserPrivacySettingsForIdentity(this.getPrivacyUserIdentity(session));
  }

  @ApiOperation({
    summary: 'Update privacy setting',
    description: 'Update a specific privacy setting for the authenticated user',
  })
  @ApiParam({
    name: 'settingType',
    description: 'Type of privacy setting to update',
    schema: {
      type: 'string',
      enum: ['analytics_tracking', 'error_debugging', 'performance_monitoring', 'cookie_banner_accepted'],
    },
  })
  @ApiBody({
    type: UpdatePrivacySettingDto,
    description: 'Privacy setting update data',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy setting updated successfully',
    type: PrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid setting type or data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid CSRF token',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Put('settings/:settingType')
  async updatePrivacySetting(
    @Param('settingType', new ParseEnumPipe(PRIVACY_SETTING_TYPES))
    settingType: PrivacySettingTypeValue,
    @Body() updateData: UpdatePrivacySettingDto,
    @Session() session: AuthSession,
  ) {
    return this.privacyService.updatePrivacySettingForIdentity(
      this.getPrivacyUserIdentity(session),
      settingType,
      updateData,
    );
  }

  @ApiOperation({
    summary: 'Bulk update privacy settings',
    description: 'Update multiple privacy settings at once',
  })
  @ApiBody({
    type: BulkUpdatePrivacySettingsDto,
    description: 'Bulk privacy settings update data',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy settings updated successfully',
    type: PrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid data',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid CSRF token',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Put('settings')
  async bulkUpdatePrivacySettings(@Body() updateData: BulkUpdatePrivacySettingsDto, @Session() session: AuthSession) {
    return this.privacyService.bulkUpdatePrivacySettingsForIdentity(this.getPrivacyUserIdentity(session), updateData);
  }

  @ApiOperation({
    summary: 'Get cookie banner status',
    description: 'Check if the cookie banner should be shown for the user',
  })
  @ApiResponse({
    status: 200,
    description: 'Cookie banner status retrieved',
    schema: {
      type: 'object',
      properties: {
        shouldShow: { type: 'boolean', example: false },
      },
    },
  })
  @Auth()
  @Get('cookie-banner/status')
  async getCookieBannerStatus(@Session() session: AuthSession) {
    const settings = await this.privacyService.getUserPrivacySettingsForIdentity(this.getPrivacyUserIdentity(session));
    return {
      shouldShow: !settings.settings.cookie_banner_accepted,
    };
  }

  @ApiOperation({
    summary: 'Get privacy directives for authenticated user',
    description:
      'Returns privacy directives for the current authenticated user in a simplified format for frontend consumption',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy directives retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        directives: {
          type: 'object',
          properties: {
            cookieBanner: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'ui' },
                name: { type: 'string', example: 'cookie-banner' },
                action: { type: 'string', example: 'hide' },
              },
            },
            analyticsTracking: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'data-handling' },
                name: { type: 'string', example: 'analytics-tracking' },
                action: { type: 'string', example: 'enable' },
              },
            },
            errorDebugging: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'data-handling' },
                name: { type: 'string', example: 'error-debugging' },
                action: { type: 'string', example: 'enable' },
              },
            },
            performanceMonitoring: {
              type: 'object',
              properties: {
                type: { type: 'string', example: 'data-handling' },
                name: { type: 'string', example: 'performance-monitoring' },
                action: { type: 'string', example: 'enable' },
              },
            },
          },
        },
        userId: { type: 'string', example: 'user-123' },
        timestamp: {
          type: 'string',
          format: 'date-time',
          example: '2025-09-11T10:30:00Z',
        },
      },
    },
  })
  @Auth()
  @Get('directives')
  async getPrivacyDirectives(@Session() session: AuthSession) {
    const settings = await this.privacyService.getUserPrivacySettingsForIdentity(this.getPrivacyUserIdentity(session));
    const settingValues = settings.settings;

    // Convert settings to frontend-friendly directive format
    const cookieBannerAccepted = settingValues.cookie_banner_accepted;

    return {
      directives: {
        cookieBanner: {
          type: 'ui',
          name: 'cookie-banner',
          action: cookieBannerAccepted ? 'hide' : 'show',
        },
        analyticsTracking: {
          type: 'data-handling',
          name: 'analytics-tracking',
          action: cookieBannerAccepted && settingValues.analytics_tracking ? 'enable' : 'disable',
        },
        errorDebugging: {
          type: 'data-handling',
          name: 'error-debugging',
          action: cookieBannerAccepted && settingValues.error_debugging ? 'enable' : 'disable',
        },
        performanceMonitoring: {
          type: 'data-handling',
          name: 'performance-monitoring',
          action: cookieBannerAccepted && settingValues.performance_monitoring ? 'enable' : 'disable',
        },
      },
      userId: session.user!.keycloakId,
      timestamp: new Date().toISOString(),
    };
  }

  @ApiOperation({
    summary: 'Accept cookie banner',
    description: 'Mark the cookie banner as accepted for the current user',
  })
  @ApiResponse({
    status: 200,
    description: 'Cookie banner accepted successfully',
    type: PrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid CSRF token',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('cookie-banner/accept')
  async acceptCookieBanner(@Session() session: AuthSession) {
    return this.privacyService.updatePrivacySettingForIdentity(
      this.getPrivacyUserIdentity(session),
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

  @ApiOperation({
    summary: 'Initialize user privacy settings',
    description: 'Initialize default privacy settings for a user (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy settings initialized successfully',
    type: PrivacySettingResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid CSRF token',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('initialize')
  async initializePrivacySettings(@Session() session: AuthSession) {
    return this.privacyService.getUserPrivacySettingsForIdentity(this.getPrivacyUserIdentity(session));
  }

  private getPrivacyUserIdentity(session: AuthSession): PrivacyUserIdentity {
    return {
      userId: session.user!.keycloakId,
    };
  }
}
