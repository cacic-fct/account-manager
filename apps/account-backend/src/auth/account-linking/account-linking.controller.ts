import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Res,
  Session,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { createAppConfig, AppConfig } from '../../config/app.config';
import { ConfigService } from '@nestjs/config';
import { Auth } from '../guards/auth.decorator';
import { CsrfGuard, SkipCsrf } from '../csrf/csrf.guard';
import { AuthSession } from '../auth.controller';
import { CurrentUserGuard } from '../guards/current-user.guard';
import { KeycloakService } from '../services/keycloak.service';
import { UserService } from '../services/user.service';
import { AccountLinkingService } from './account-linking.service';
import {
  AccountLinkingStartUrlDto,
  AccountMergeRequestDto,
  ConfirmAccountMergeDto,
  ConfirmAccountMergeResponseDto,
} from './dto/account-linking.dto';

@ApiTags('Account linking')
@Controller('auth/account-linking')
export class AccountLinkingController {
  private readonly logger = new Logger(AccountLinkingController.name);
  private readonly appConfig!: AppConfig;

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly userService: UserService,
    private readonly accountLinkingService: AccountLinkingService,
    private readonly configService: ConfigService,
  ) {
    this.appConfig = createAppConfig(this.configService);
  }

  @ApiOperation({
    summary: 'Build Google account-linking login URL',
    description:
      'Returns a Keycloak logout URL followed by an OAuth URL so a different Google account can be authenticated before a merge is confirmed.',
  })
  @ApiResponse({ status: 200, type: AccountLinkingStartUrlDto })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('google/start')
  startGoogleLinking(
    @Session() session: AuthSession,
  ): AccountLinkingStartUrlDto {
    const state = randomBytes(32).toString('hex');
    session.accountLinkingState = state;
    session.accountLinkingUserId = session.user!.keycloakId;

    const resumeUrl = `${this.appConfig.backendUrl}/auth/account-linking/google/resume?state=${encodeURIComponent(state)}`;
    const url = this.keycloakService.getEndSessionUrl(
      resumeUrl,
      session.idToken,
    );

    return { url };
  }

  @ApiOperation({
    summary: 'Resume Google account-linking after clearing Keycloak SSO',
  })
  @SkipCsrf()
  @Get('google/resume')
  resumeGoogleLinking(
    @Query('state') state: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ) {
    try {
      if (
        !state ||
        !session.accountLinkingState ||
        !this.secureCompare(state, session.accountLinkingState)
      ) {
        throw new HttpException(
          'Invalid or missing state parameter',
          HttpStatus.FORBIDDEN,
        );
      }

      const redirectUri = `${this.appConfig.backendUrl}/auth/account-linking/google/callback`;
      const url = this.keycloakService.getAuthUrl(redirectUri, state, {
        prompt: 'login',
        maxAge: 0,
      });

      res.redirect(url);
    } catch (error) {
      this.logger.error('Google account-linking resume failed', error);
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;
      res.redirect(this.googleIntegrationUrl({ accountLink: 'failed' }));
    }
  }

  @ApiOperation({
    summary: 'Handle Google account-linking OAuth callback',
  })
  @SkipCsrf()
  @Get('google/callback')
  async googleCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') oauthError: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ) {
    try {
      if (
        !state ||
        !session.accountLinkingState ||
        !this.secureCompare(state, session.accountLinkingState)
      ) {
        throw new HttpException(
          'Invalid or missing state parameter',
          HttpStatus.FORBIDDEN,
        );
      }

      const requesterUserId = session.accountLinkingUserId;
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;

      if (!requesterUserId || !session.user) {
        throw new HttpException('Session expired', HttpStatus.UNAUTHORIZED);
      }

      if (oauthError || !code) {
        res.redirect(this.googleIntegrationUrl({ accountLink: 'failed' }));
        return;
      }

      const redirectUri = `${this.appConfig.backendUrl}/auth/account-linking/google/callback`;
      const tokens = await this.keycloakService.exchangeCodeForTokens(
        code,
        redirectUri,
      );
      const keycloakUser = await this.keycloakService.getUserInfo(
        tokens.access_token,
      );

      let candidate = await this.userService.findByKeycloakId(keycloakUser.sub);
      if (!candidate) {
        candidate = await this.userService.createFromKeycloak(keycloakUser);
      } else {
        candidate =
          await this.userService.updateFromKeycloakOAuth(keycloakUser);
      }

      if (candidate.keycloakId === requesterUserId) {
        res.redirect(
          this.googleIntegrationUrl({ accountLink: 'already-linked' }),
        );
        return;
      }

      const mergeRequest = await this.accountLinkingService.createMergeRequest(
        requesterUserId,
        candidate.keycloakId,
      );

      const params = new URLSearchParams({
        accountLink: 'merge-required',
        merge_request: mergeRequest.id,
      });
      res.redirect(this.googleIntegrationUrl(params));
    } catch (error) {
      this.logger.error('Google account-linking callback failed', error);
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;
      res.redirect(this.googleIntegrationUrl({ accountLink: 'failed' }));
    }
  }

  @ApiOperation({ summary: 'Get a pending account merge request' })
  @ApiResponse({ status: 200 })
  @Auth()
  @UseGuards(CurrentUserGuard)
  @SkipCsrf()
  @Get('merge-requests/:id')
  async getMergeRequest(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<AccountMergeRequestDto> {
    const request = await this.accountLinkingService.getRequest(
      id,
      session.user!.keycloakId,
    );

    if (
      request.primaryUserId &&
      ['pending_merge', 'completed'].includes(request.status) &&
      session.user?.keycloakId !== request.primaryUserId
    ) {
      await this.switchSessionToUser(session, request.primaryUserId);
    }

    return request;
  }

  @ApiOperation({ summary: 'Confirm an account merge' })
  @ApiResponse({ status: 200 })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('merge-requests/:id/confirm')
  async confirmMerge(
    @Param('id') id: string,
    @Body() dto: ConfirmAccountMergeDto,
    @Session() session: AuthSession,
  ): Promise<ConfirmAccountMergeResponseDto> {
    const result = await this.accountLinkingService.confirmMerge(
      id,
      session.user!.keycloakId,
      dto.primaryEmail,
    );

    return result;
  }

  @ApiOperation({ summary: 'Cancel a pending account merge' })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('merge-requests/:id/cancel')
  async cancelMerge(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<{ success: true }> {
    await this.accountLinkingService.cancelRequest(
      id,
      session.user!.keycloakId,
    );
    return { success: true };
  }

  private secureCompare(a: string, b: string): boolean {
    try {
      const bufferA = Buffer.from(a, 'utf-8');
      const bufferB = Buffer.from(b, 'utf-8');

      if (bufferA.length !== bufferB.length) {
        return false;
      }

      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  private googleIntegrationUrl(
    query?: URLSearchParams | Record<string, string>,
  ): string {
    const url = new URL(
      LINKED_ACCOUNT_ROUTE_PATHS.google,
      this.appConfig.frontendUrl,
    );

    if (query instanceof URLSearchParams) {
      url.search = query.toString();
    } else if (query) {
      url.search = new URLSearchParams(query).toString();
    }

    return url.toString();
  }

  private async switchSessionToUser(
    session: AuthSession,
    keycloakId: string,
  ): Promise<void> {
    const primaryUser = await this.userService.findByKeycloakId(keycloakId);
    if (!primaryUser) {
      this.logger.warn(
        `Unable to switch session: user not found for keycloakId ${keycloakId}`,
      );
      return;
    }

    if (!session.user) {
      return;
    }

    session.user = {
      id: primaryUser.id,
      email: primaryUser.email,
      keycloakId: primaryUser.keycloakId,
      isOnboarded: primaryUser.isOnboarded,
    };
  }
}
