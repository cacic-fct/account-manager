import { Controller, Get, Delete, Query, Param, Session, Res, Logger, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiParam, ApiResponse } from '@nestjs/swagger';
import { LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';
import { ConfigService } from '@nestjs/config';
import { createAppConfig, AppConfig } from '../config/app.config';
import { DiscordOAuthService } from './services/discord-oauth.service';
import { DiscordLinkService } from './services/discord-link.service';
import { Auth } from '../auth/guards/auth.decorator';
import { CurrentUserGuard } from '../auth/guards/current-user.guard';
import { CsrfGuard } from '../auth/csrf/csrf.guard';
import { DiscordLinkStatusDto, UnlinkDiscordResponseDto } from './dto/discord-link.dto';

interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  discordOAuthState?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

interface SessionUser {
  keycloakId: string;
  email: string;
  fullname: string;
  displayName: string;
}

@ApiTags('Discord Integration')
@Controller('discord')
export class DiscordController {
  private readonly appConfig!: AppConfig;
  private readonly logger = new Logger(DiscordController.name);

  constructor(
    private readonly discordOAuthService: DiscordOAuthService,
    private readonly discordLinkService: DiscordLinkService,
    private readonly configService: ConfigService,
  ) {
    this.appConfig = createAppConfig(this.configService);
  }

  @ApiOperation({
    summary: 'Get Discord OAuth URL',
    description: 'Get the Discord OAuth URL for linking Discord account',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord OAuth URL returned successfully',
    schema: {
      type: 'object',
      properties: {
        authUrl: {
          type: 'string',
          example: 'https://discord.com/api/oauth2/authorize?...',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('auth-url')
  getDiscordAuthUrl(@Session() session: AuthSession): { authUrl: string } {
    const oauthData: { authUrl: string; state: string } = this.discordOAuthService.getDiscordAuthUrl(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
    );
    session.discordOAuthState = oauthData.state;
    return { authUrl: oauthData.authUrl };
  }

  @ApiOperation({
    summary: 'Discord OAuth callback',
    description: 'Handle Discord OAuth callback and link account',
  })
  @ApiQuery({
    name: 'code',
    description: 'Discord OAuth authorization code',
    required: true,
  })
  @ApiQuery({
    name: 'state',
    description: 'OAuth state parameter',
    required: true,
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to frontend after processing',
  })
  @Auth()
  @Get('callback')
  async discordCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
    @Session() session: AuthSession,
  ) {
    try {
      if (!code || !state) {
        return res.redirect(this.discordIntegrationUrl({ error: 'missing_parameters' }));
      }

      if (!session.discordOAuthState) {
        return res.redirect(this.discordIntegrationUrl({ error: 'invalid_state' }));
      }

      this.discordOAuthService.verifyOAuthState(state, session.discordOAuthState);
      delete session.discordOAuthState;

      // Process the OAuth callback
      await this.discordLinkService.linkDiscordAccount(session.user!.keycloakId, {
        code,
        state,
      });

      return res.redirect(this.discordIntegrationUrl({ success: 'true' }));
    } catch (error) {
      this.logger.error('Discord OAuth callback error', error);

      // Check for specific error types
      let errorType = 'callback_failed';
      if (error instanceof Error && error.message.includes('already linked')) {
        errorType = 'already_linked';
      }

      return res.redirect(this.discordIntegrationUrl({ error: errorType }));
    }
  }

  @ApiOperation({
    summary: 'Get Discord link status',
    description: 'Get the Discord link status for the authenticated user, including invite links for eligible users',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord link status returned successfully',
    type: DiscordLinkStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('status')
  async getDiscordLinkStatus(@Session() session: AuthSession): Promise<DiscordLinkStatusDto> {
    return await this.discordLinkService.getDiscordLinkStatus(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
    );
  }

  @ApiOperation({
    summary: 'Unlink Discord account',
    description: 'Unlink a specific Discord account from the user profile',
  })
  @ApiParam({
    name: 'linkId',
    description: 'Discord link ID to unlink',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord account unlinked successfully',
    type: UnlinkDiscordResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 404,
    description: 'No Discord link found for this user',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Delete('link/:linkId')
  async unlinkDiscord(
    @Param('linkId') linkId: string,
    @Session() session: AuthSession,
  ): Promise<UnlinkDiscordResponseDto> {
    await this.discordLinkService.unlinkDiscordAccount(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      linkId,
    );
    return { message: 'Conta do Discord desvinculada com sucesso' };
  }

  private discordIntegrationUrl(query: Record<string, string>): string {
    const url = new URL(LINKED_ACCOUNT_ROUTE_PATHS.discord, this.appConfig.frontendUrl);
    url.search = new URLSearchParams(query).toString();
    return url.toString();
  }
}
