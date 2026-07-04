import { Controller, Get, Query, UseGuards, BadRequestException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';
import { M2M_PRIVACY_ROLES } from '@cacic/m2m-contracts';
import { M2MGuard, M2MProtected, RequireRoles } from '../../auth/jwt/m2m.guard';
import { PrivacyDirectiveService } from '../services/privacy-directive.service';
import { PrivacyDirective, PrivacyDirectiveDataMap, PrivacyDirectiveUiMap } from '../constants/privacy-directives';

@ApiTags('Privacy Directives')
@Controller('privacy-directives')
@UseGuards(M2MGuard)
@M2MProtected()
export class PrivacyDirectiveController {
  constructor(private readonly privacyDirectiveService: PrivacyDirectiveService) {}

  @Get('')
  @ApiOperation({
    summary: 'Get privacy directives for a user',
    description:
      'Returns privacy directives that tell other applications what UI elements to show and how to handle user data. Requires M2M authentication with privacy:read realm role.',
  })
  @RequireRoles(M2M_PRIVACY_ROLES.READ)
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
              type: { type: 'string', example: 'ui_cookie_banner' },
              value: { type: 'string', example: 'show' },
              metadata: {
                type: 'object',
                example: {
                  reason: 'banner_not_accepted',
                  timestamp: '2025-09-11T10:30:00Z',
                },
              },
            },
          },
          example: [
            {
              type: 'ui_cookie_banner',
              value: 'show',
              metadata: {
                reason: 'banner_not_accepted',
                timestamp: '2025-09-11T10:30:00Z',
              },
            },
            {
              type: 'data_analytics_tracking',
              value: 'allow',
              metadata: {
                reason: 'user_preference',
                timestamp: '2025-09-11T10:30:00Z',
              },
            },
          ],
        },
        ui: {
          type: 'object',
          description: 'UI directives (what to show/hide)',
          example: {
            ui_cookie_banner: 'show',
          },
        },
        data: {
          type: 'object',
          description: 'Data handling directives (what to block/allow)',
          example: {
            data_analytics_tracking: 'allow',
            data_error_debugging: 'block',
            data_performance_monitoring: 'allow',
          },
        },
      },
      example: {
        directives: [
          {
            type: 'ui_cookie_banner',
            value: 'show',
            metadata: {
              reason: 'User has not yet accepted cookies',
              timestamp: '2025-09-11T10:30:00Z',
            },
          },
          {
            type: 'data_analytics_tracking',
            value: 'allow',
            metadata: {
              reason: 'User has consented to analytics',
              timestamp: '2025-09-10T15:20:00Z',
            },
          },
        ],
        ui: {
          ui_cookie_banner: 'show',
          ui_analytics_consent: 'hide',
          ui_performance_consent: 'show',
          ui_error_reporting_consent: 'hide',
        },
        data: {
          data_analytics_tracking: 'allow',
          data_error_debugging: 'block',
          data_performance_monitoring: 'allow',
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
    ui: PrivacyDirectiveUiMap;
    data: PrivacyDirectiveDataMap;
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
  @RequireRoles(M2M_PRIVACY_ROLES.READ)
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
        ui_cookie_banner: 'show',
      },
    },
  })
  async getUiDirectives(@Query('userId') userId?: string): Promise<PrivacyDirectiveUiMap> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const { ui } = await this.privacyDirectiveService.getDirectivesAsJson(userId);
    return ui;
  }

  @Get('data')
  @ApiOperation({
    summary: 'Get data handling directives only',
    description:
      'Returns only the data handling directives (what to block/allow) for easier consumption by backend applications.',
  })
  @RequireRoles(M2M_PRIVACY_ROLES.READ)
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
        data_analytics_tracking: 'allow',
        data_error_debugging: 'block',
        data_performance_monitoring: 'allow',
      },
    },
  })
  async getDataDirectives(@Query('userId') userId?: string): Promise<PrivacyDirectiveDataMap> {
    if (!userId || userId.trim() === '') {
      throw new BadRequestException('User ID is required');
    }

    const { data } = await this.privacyDirectiveService.getDirectivesAsJson(userId);
    return data;
  }
}
