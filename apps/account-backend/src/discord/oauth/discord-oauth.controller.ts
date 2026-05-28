import { Controller, Get, Logger, Query, Res, Session } from '@nestjs/common';
import { Response } from 'express';
import { ApiTags, ApiOperation, ApiQuery, ApiResponse } from '@nestjs/swagger';
import { DiscordOAuthService } from '../services/discord-oauth.service';
import { ConfigService } from '@nestjs/config';
import { createAppConfig, AppConfig } from '../../config/app.config';
import { Auth } from '../../auth/guards/auth.decorator';

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

@ApiTags('Discord OAuth')
@Controller('discord/oauth')
export class DiscordOAuthController {
  private readonly appConfig: AppConfig;
  private readonly logger = new Logger(DiscordOAuthController.name);

  constructor(
    private readonly discordOAuthService: DiscordOAuthService,
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
  getDiscordAuthUrl(@Session() session: AuthSession) {
    const { authUrl, state } = this.discordOAuthService.getDiscordAuthUrl(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
    );
    session.discordOAuthState = state;
    return { authUrl };
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
  discordCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Res() res: Response,
  ) {
    try {
      if (!code || !state) {
        return res.redirect(
          `${this.appConfig.frontendUrl}settings/linked-accounts?error=missing_parameters`,
        );
      }

      // Redirect to main controller callback endpoint for processing
      return res.redirect(
        `/api/discord/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`,
      );
    } catch (error) {
      this.logger.error('Discord OAuth callback error', error);
      return res.redirect(
        `${this.appConfig.frontendUrl}settings/linked-accounts?error=callback_failed`,
      );
    }
  }
}
