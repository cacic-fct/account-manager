import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Session,
  UseGuards,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiBody,
  ApiResponse,
} from '@nestjs/swagger';
import { DiscordSettingsService } from '../services/discord-settings.service';
import { DiscordMetadataService } from '../services/discord-metadata.service';
import { DiscordLinkService } from '../services/discord-link.service';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { Auth, DiscordAdmin } from '../../auth/guards/auth.decorator';
import { hasRequiredKeycloakRoles } from '../../auth/guards/keycloak-role.guard';
import { CsrfGuard } from '../../auth/csrf/csrf.guard';
import {
  ServerSettingDto,
  UpdateServerSettingDto,
} from '../dto/server-settings.dto';

interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

interface SessionUser {
  keycloakId: string;
  email: string;
  fullname: string;
  displayName: string;
}

@ApiTags('Discord Admin')
@Controller('discord/admin')
export class DiscordAdminController {
  constructor(
    private readonly discordSettingsService: DiscordSettingsService,
    private readonly discordMetadataService: DiscordMetadataService,
    private readonly discordLinkService: DiscordLinkService,
    private readonly keycloakService: KeycloakService,
  ) {}

  @ApiOperation({
    summary: 'Check admin status',
    description: 'Check if the current user has discord-admin role',
  })
  @ApiResponse({
    status: 200,
    description: 'Admin status returned successfully',
    schema: {
      type: 'object',
      properties: {
        isAdmin: {
          type: 'boolean',
          example: true,
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('status')
  async getAdminStatus(
    @Session() session: AuthSession,
  ): Promise<{ isAdmin: boolean }> {
    try {
      const userRoles = await this.keycloakService.getUserRoles(
        session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      );
      const isAdmin = hasRequiredKeycloakRoles(userRoles, ['discord-admin']);
      return { isAdmin };
    } catch {
      return { isAdmin: false };
    }
  }

  @ApiOperation({
    summary: 'Get all server settings',
    description: 'Get all Discord server settings (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Server settings returned successfully',
    type: [ServerSettingDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @Get('settings')
  async getAllServerSettings(): Promise<ServerSettingDto[]> {
    return await this.discordSettingsService.getAllServerSettings();
  }

  @ApiOperation({
    summary: 'Update server setting',
    description: 'Update a Discord server setting (admin only)',
  })
  @ApiParam({
    name: 'key',
    description: 'Setting key',
    example: 'student_invite_link',
  })
  @ApiBody({
    type: UpdateServerSettingDto,
    description: 'New setting value',
  })
  @ApiResponse({
    status: 200,
    description: 'Server setting updated successfully',
    type: ServerSettingDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @UseGuards(CsrfGuard)
  @Put('settings/:key')
  async updateServerSetting(
    @Param('key') key: string,
    @Body() dto: UpdateServerSettingDto,
  ): Promise<ServerSettingDto> {
    return await this.discordSettingsService.updateServerSetting(key, dto);
  }

  @ApiOperation({
    summary: 'Register Discord application metadata',
    description: 'Register role metadata with Discord for Linked Roles feature',
  })
  @ApiResponse({
    status: 200,
    description: 'Application metadata registered successfully',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @UseGuards(CsrfGuard)
  @Post('register-metadata')
  async registerApplicationMetadata(): Promise<{ message: string }> {
    await this.discordMetadataService.registerApplicationMetadata();
    return { message: 'Discord application metadata registered successfully' };
  }

  @ApiOperation({
    summary: 'Get all Discord links for user (including deleted)',
    description:
      'Get all Discord links for a user, including soft-deleted ones - Admin only',
  })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak User ID',
    example: 'f5fc286c-2025-4567-8901-234567890abc',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord links returned successfully',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @Get('user/:userId/links')
  async getAllUserDiscordLinks(@Param('userId') userId: string) {
    const links = await this.discordLinkService.getAllDiscordLinksForUser(
      userId,
      true,
    );
    return { links };
  }

  @ApiOperation({
    summary: 'Restore soft-deleted Discord link',
    description: 'Restore a soft-deleted Discord link - Admin only',
  })
  @ApiParam({
    name: 'linkId',
    description: 'Discord Link ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord link restored successfully',
  })
  @ApiResponse({
    status: 404,
    description: 'No deleted Discord link found',
  })
  @ApiResponse({
    status: 400,
    description: 'Discord account is currently linked to another user',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @UseGuards(CsrfGuard)
  @Post('links/:linkId/restore')
  async restoreDiscordLink(@Param('linkId') linkId: string) {
    const restoredLink =
      await this.discordLinkService.restoreDiscordLink(linkId);
    return {
      message: 'Discord link restored successfully',
      link: restoredLink,
    };
  }
}
