import {
  Controller,
  Get,
  Query,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { M2MGuard, M2MProtected, RequireRoles } from '../../auth/jwt/m2m.guard';
import { PrivacyDirectiveService } from '../services/privacy-directive.service';
import { PrivacyDirective } from '../constants/privacy-directives';

@ApiTags('Privacy Directives')
@Controller('privacy-directives')
@UseGuards(M2MGuard)
@M2MProtected()
export class PrivacyDirectiveController {
  constructor(
    private readonly privacyDirectiveService: PrivacyDirectiveService,
  ) {}

  @Get('')
  @ApiOperation({
    summary: 'Get privacy directives for a user',
    description:
      'Returns privacy directives that tell other applications what UI elements to show and how to handle user data. Requires M2M authentication with privacy:read realm role.',
  })
  @RequireRoles('privacy:read')
  @ApiQuery({
    name: 'userId',
    description: 'The user ID to get directives for',
    required: true,
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiResponse({
    status: 200,
    description: 'Privacy directives retrieved successfully',
    schema: {
      type: 'object',
      properties: {
        directives: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', example: 'ui' },
              value: { type: 'string', example: 'show' },
              metadata: {
                type: 'object',
                example: {
                  settingType: 'cookie_banner_accepted',
                  lastUpdated: '2025-09-11T10:30:00Z',
                  source: 'user_preference',
                },
              },
            },
          },
          example: [
            {
              type: 'ui',
              value: 'show',
              metadata: {
                settingType: 'cookie_banner_accepted',
                directive: 'CACIC_CookieBanner',
                lastUpdated: '2025-09-11T10:30:00Z',
              },
            },
            {
              type: 'data',
              value: 'allow',
              metadata: {
                settingType: 'analytics_tracking',
                directive: 'CACIC_AnalyticsTracking',
                lastUpdated: '2025-09-11T10:30:00Z',
              },
            },
          ],
        },
        ui: {
          type: 'object',
          description: 'UI directives (what to show/hide)',
          example: {
            'cookie-banner': 'show',
          },
        },
        data: {
          type: 'object',
          description: 'Data handling directives (what to block/allow)',
          example: {
            'analytics-tracking': 'allow',
            'error-debugging': 'block',
            'performance-monitoring': 'allow',
          },
        },
      },
      example: {
        directives: [
          {
            type: 'ui',
            value: 'show',
            metadata: {
              settingType: 'cookie_banner_accepted',
              directive: 'CACIC_CookieBanner',
              reason: 'User has not yet accepted cookies',
              lastUpdated: '2025-09-11T10:30:00Z',
            },
          },
          {
            type: 'data',
            value: 'allow',
            metadata: {
              settingType: 'analytics_tracking',
              directive: 'CACIC_AnalyticsTracking',
              reason: 'User has consented to analytics',
              lastUpdated: '2025-09-10T15:20:00Z',
            },
          },
        ],
        ui: {
          'cookie-banner': 'show',
          'analytics-opt-out': 'hide',
          'performance-monitoring-notice': 'show',
          'error-reporting-consent': 'hide',
        },
        data: {
          'analytics-tracking': 'allow',
          'error-debugging': 'block',
          'performance-monitoring': 'allow',
          'discord-integration': 'allow',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Invalid request - userId is required',
  })
  async getUserDirectives(@Query('userId') userId?: string): Promise<{
    directives: PrivacyDirective[];
    ui: Record<string, string>;
    data: Record<string, string>;
  }> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    return this.privacyDirectiveService.getDirectivesAsJson(userId);
  }

  @Get('ui')
  @ApiOperation({
    summary: 'Get UI directives only',
    description:
      'Returns only the UI directives (what elements to show/hide) for easier consumption by frontend applications.',
  })
  @RequireRoles('privacy:read')
  @ApiQuery({
    name: 'userId',
    description: 'The user ID to get UI directives for',
    required: true,
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiResponse({
    status: 200,
    description: 'UI directives retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'string',
        enum: ['show', 'hide'],
      },
      example: {
        'cookie-banner': 'show',
      },
    },
  })
  async getUiDirectives(
    @Query('userId') userId?: string,
  ): Promise<Record<string, string>> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const { ui } =
      await this.privacyDirectiveService.getDirectivesAsJson(userId);
    return ui;
  }

  @Get('data')
  @ApiOperation({
    summary: 'Get data handling directives only',
    description:
      'Returns only the data handling directives (what to block/allow) for easier consumption by backend applications.',
  })
  @RequireRoles('privacy:read')
  @ApiQuery({
    name: 'userId',
    description: 'The user ID to get data directives for',
    required: true,
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @ApiResponse({
    status: 200,
    description: 'Data directives retrieved successfully',
    schema: {
      type: 'object',
      additionalProperties: {
        type: 'string',
        enum: ['allow', 'block'],
      },
      example: {
        'analytics-tracking': 'allow',
        'error-debugging': 'block',
        'performance-monitoring': 'allow',
      },
    },
  })
  async getDataDirectives(
    @Query('userId') userId?: string,
  ): Promise<Record<string, string>> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const { data } =
      await this.privacyDirectiveService.getDirectivesAsJson(userId);
    return data;
  }
}
