import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  MessageEvent,
  Param,
  Post,
  Query,
  Res,
  Session,
  Sse,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountMergeRequest, AccountMergeRequestDelta, LINKED_ACCOUNT_ROUTE_PATHS } from '@cacic/shared-types';
import { randomBytes, timingSafeEqual } from 'crypto';
import { Response } from 'express';
import { concat, concatMap, finalize, from, map, Observable, of, scan, takeWhile } from 'rxjs';
import { createAppConfig, AppConfig } from '../../config/app.config';
import { ConfigService } from '@nestjs/config';
import { Auth } from '../guards/auth.decorator';
import { CsrfGuard, SkipCsrf } from '../csrf/csrf.guard';
import { AuthSession } from '../auth.controller';
import { createPkceChallenge } from '../pkce.utils';
import { CurrentUserGuard } from '../guards/current-user.guard';
import { KeycloakService } from '../services/keycloak.service';
import { UserService } from '../services/user.service';
import { AccountLinkingService } from './account-linking.service';
import { redirectAfterSessionSave, saveSession } from '../session-redirect.utils';
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
  startGoogleLinking(@Session() session: AuthSession): AccountLinkingStartUrlDto {
    const state = randomBytes(32).toString('hex');
    session.accountLinkingState = state;
    session.accountLinkingUserId = session.user!.keycloakId;

    const resumeUrl = `${this.appConfig.apiBaseUrl}/auth/account-linking/google/resume?state=${encodeURIComponent(state)}`;
    const url = this.keycloakService.getEndSessionUrl(resumeUrl, session.idToken);

    return { url };
  }

  @ApiOperation({
    summary: 'Resume Google account-linking after clearing Keycloak SSO',
  })
  @SkipCsrf()
  @Get('google/resume')
  async resumeGoogleLinking(
    @Query('state') state: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ): Promise<void> {
    try {
      if (!state || !session.accountLinkingState || !this.secureCompare(state, session.accountLinkingState)) {
        throw new HttpException('Invalid or missing state parameter', HttpStatus.FORBIDDEN);
      }

      const redirectUri = this.googleCallbackUrl();
      const pkce = createPkceChallenge();
      session.accountLinkingCodeVerifier = pkce.verifier;
      const url = this.keycloakService.getAuthUrl(redirectUri, state, {
        prompt: 'login',
        maxAge: 0,
        codeChallenge: pkce.challenge,
      });

      await redirectAfterSessionSave(session, res, url);
    } catch (error) {
      this.logger.error('Google account-linking resume failed', error);
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;
      delete session.accountLinkingCodeVerifier;
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
      if (!state || !session.accountLinkingState || !this.secureCompare(state, session.accountLinkingState)) {
        throw new HttpException('Invalid or missing state parameter', HttpStatus.FORBIDDEN);
      }

      const requesterUserId = session.accountLinkingUserId;
      const codeVerifier = session.accountLinkingCodeVerifier;
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;
      delete session.accountLinkingCodeVerifier;

      if (!requesterUserId || !session.user) {
        throw new HttpException('Session expired', HttpStatus.UNAUTHORIZED);
      }

      if (oauthError || !code) {
        res.redirect(this.googleIntegrationUrl({ accountLink: 'failed' }));
        return;
      }

      const redirectUri = this.googleCallbackUrl();
      const tokens = await this.keycloakService.exchangeCodeForTokens(code, redirectUri, codeVerifier);
      const keycloakUser = await this.keycloakService.getUserInfo(tokens.access_token);

      let candidate = await this.userService.findByKeycloakId(keycloakUser.sub);
      if (!candidate) {
        candidate = await this.userService.createFromKeycloak(keycloakUser);
      } else {
        candidate = await this.userService.updateFromKeycloakOAuth(keycloakUser);
      }

      if (candidate.keycloakId === requesterUserId) {
        res.redirect(this.googleIntegrationUrl({ accountLink: 'already-linked' }));
        return;
      }

      const mergeRequest = await this.accountLinkingService.createMergeRequest(requesterUserId, candidate.keycloakId);

      const params = new URLSearchParams({
        accountLink: 'merge-required',
        merge_request: mergeRequest.id,
      });
      res.redirect(this.googleIntegrationUrl(params));
    } catch (error) {
      this.logger.error('Google account-linking callback failed', error);
      delete session.accountLinkingState;
      delete session.accountLinkingUserId;
      delete session.accountLinkingCodeVerifier;
      res.redirect(this.googleIntegrationUrl({ accountLink: 'failed' }));
    }
  }

  @ApiOperation({ summary: 'Get a pending account merge request' })
  @ApiResponse({ status: 200 })
  @Auth()
  @SkipCsrf()
  @Get('merge-requests/:id')
  async getMergeRequest(@Param('id') id: string, @Session() session: AuthSession): Promise<AccountMergeRequestDto> {
    return this.getMergeRequestForSession(id, session);
  }

  @ApiOperation({ summary: 'Stream account merge status updates' })
  @Auth()
  @SkipCsrf()
  @Sse('merge-requests/:id/events')
  async streamMergeRequest(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<Observable<MessageEvent>> {
    const watch = await this.accountLinkingService.openMergeRequestWatch(id);

    try {
      const initialRequest = await this.getMergeRequestForSession(id, session);

      return concat(
        of(initialRequest),
        watch.updates.pipe(concatMap(() => from(this.getMergeRequestForSession(id, session)))),
      ).pipe(
        takeWhile((request) => !isTerminalMergeRequest(request), true),
        // A stream event carries only fields that changed since the preceding event.
        // The first event is a complete snapshot, after the Redis subscription is ready.
        scan((state, request) => ({ previous: request, delta: toMergeRequestDelta(state.previous, request) }), {
          previous: null as AccountMergeRequest | null,
          delta: null as AccountMergeRequestDelta | null,
        }),
        map(({ delta }) => ({ data: delta! })),
        finalize(() => watch.close()),
      );
    } catch (error) {
      watch.close();
      throw error;
    }
  }

  private async getMergeRequestForSession(id: string, session: AuthSession): Promise<AccountMergeRequestDto> {
    const request = await this.accountLinkingService.getRequest(id, session.user!.keycloakId);

    if (
      request.primaryUserId &&
      ['pending_merge', 'completed'].includes(request.status) &&
      session.user?.keycloakId !== request.primaryUserId
    ) {
      await this.switchSessionToUser(session, request.primaryUserId);
      await saveSession(session);
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
    const result = await this.accountLinkingService.confirmMerge(id, session.user!.keycloakId, dto.primaryEmail);

    return result;
  }

  @ApiOperation({ summary: 'Cancel a pending account merge' })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('merge-requests/:id/cancel')
  async cancelMerge(@Param('id') id: string, @Session() session: AuthSession): Promise<{ success: true }> {
    await this.accountLinkingService.cancelRequest(id, session.user!.keycloakId);
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

  private googleIntegrationUrl(query?: URLSearchParams | Record<string, string>): string {
    const url = new URL(LINKED_ACCOUNT_ROUTE_PATHS.google, this.appConfig.frontendUrl);

    if (query instanceof URLSearchParams) {
      url.search = query.toString();
    } else if (query) {
      url.search = new URLSearchParams(query).toString();
    }

    return url.toString();
  }

  private googleCallbackUrl(): string {
    return `${this.appConfig.apiBaseUrl}/auth/account-linking/google/callback`;
  }

  private async switchSessionToUser(session: AuthSession, keycloakId: string): Promise<void> {
    const primaryUser = await this.userService.findByKeycloakId(keycloakId);
    if (!primaryUser) {
      this.logger.warn(`Unable to switch session: user not found for keycloakId ${keycloakId}`);
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

function toMergeRequestDelta(
  previous: AccountMergeRequest | null,
  current: AccountMergeRequest,
): AccountMergeRequestDelta {
  if (!previous) {
    return current;
  }

  const delta: AccountMergeRequestDelta = { id: current.id };
  for (const key of Object.keys(current) as Array<keyof AccountMergeRequest>) {
    if (key !== 'id' && JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      Object.assign(delta, { [key]: current[key] });
    }
  }

  return delta;
}

function isTerminalMergeRequest(request: AccountMergeRequest): boolean {
  return ['completed', 'cancelled', 'expired', 'failed'].includes(request.status);
}
