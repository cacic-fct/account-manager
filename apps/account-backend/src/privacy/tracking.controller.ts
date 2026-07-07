import { Controller, Get, Post, Res, Session, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOkResponse, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthSession } from '../auth/auth.controller';
import { AuthGuard } from '../auth/guards/auth.guard';
import { SkipCsrf } from '../auth/csrf/csrf.guard';
import { PrivacyService } from './privacy.service';
import type { PrivacySettings } from './constants/privacy-setting.constants';
import { clearCacicTrackingCookies, refreshCacicTrackingCookies } from './tracking-cookie.utils';
import type { CacicTrackingSessionResponse } from './constants/privacy-directives';

@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(
    private readonly privacyService: PrivacyService,
    private readonly configService: ConfigService,
  ) {}

  @ApiOperation({
    summary: 'Refresh cross-site tracking cookies',
    description:
      'Refreshes shared CACiC analytics cookies for the authenticated SSO user when account privacy settings allow analytics tracking.',
  })
  @ApiOkResponse({
    description: 'Tracking cookies were refreshed or cleared based on the user account privacy settings.',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @UseGuards(AuthGuard)
  @SkipCsrf()
  @Get('session')
  async refreshSessionTracking(
    @Session() session: AuthSession,
    @Res({ passthrough: true }) response: Response,
  ): Promise<CacicTrackingSessionResponse> {
    const privacyState = await this.resolvePrivacyState(session.user!.keycloakId);

    const result = refreshCacicTrackingCookies(response, this.configService, {
      keycloakId: session.user!.keycloakId,
      analyticsAllowed: privacyState.analyticsAllowed,
      cookieBannerAccepted: privacyState.cookieBannerAccepted,
      updatedAt: privacyState.updatedAt,
    });

    return {
      analyticsAllowed: result.analyticsAllowed,
      cookieBannerAccepted: result.cookieBannerAccepted,
      ...(result.userId ? { userId: result.userId } : {}),
      ...(result.expiresAt ? { expiresAt: result.expiresAt } : {}),
    };
  }

  @ApiOperation({
    summary: 'Clear cross-site tracking cookies',
    description:
      'Clears CACiC analytics and privacy directive cookies. Intended for logout flows in any CACiC SSO project.',
  })
  @ApiOkResponse({
    description: 'Tracking cookies cleared successfully.',
  })
  @SkipCsrf()
  @Post('clear')
  clearTrackingCookies(@Res({ passthrough: true }) response: Response): {
    cleared: true;
  } {
    clearCacicTrackingCookies(response, this.configService);
    return { cleared: true };
  }

  private async resolvePrivacyState(userId: string): Promise<{
    analyticsAllowed: boolean;
    cookieBannerAccepted: boolean;
    updatedAt: Date;
  }> {
    const settings = await this.privacyService.findUserSettingsForIdentity({
      userId,
    });

    if (!settings) {
      return {
        analyticsAllowed: false,
        cookieBannerAccepted: false,
        updatedAt: new Date(),
      };
    }

    return {
      analyticsAllowed: this.canTrack(settings.settings),
      cookieBannerAccepted: settings.settings.cookie_banner_accepted,
      updatedAt: settings.updatedAt,
    };
  }

  private canTrack(settings: PrivacySettings): boolean {
    return settings.analytics_tracking;
  }
}
