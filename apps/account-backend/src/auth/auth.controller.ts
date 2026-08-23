import {
  Controller,
  Get,
  Post,
  Query,
  Body,
  Res,
  Session,
  HttpException,
  HttpStatus,
  HttpCode,
  UseGuards,
  Logger,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery, ApiBody } from '@nestjs/swagger';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { KeycloakConnectionException } from './exceptions/keycloak-connection.exception';
import { Auth } from './guards/auth.decorator';
import {
  CreateUserProfileDto,
  UserProfileDto,
  AuthStatusDto,
  OnboardingStatusDto,
  PasswordLoginDto,
  PasswordLoginResponseDto,
  UnespRoleRequiredDto,
  UserApplicationDto,
  LogoutRequestDto,
  LogoutResponseDto,
} from './dto/user-profile.dto';
import { KeycloakUser, SessionUser, UserProfile } from './interfaces/auth.interface';
import { createAppConfig, AppConfig } from '../config/app.config';
import { CsrfGuard, SkipCsrf } from './csrf/csrf.guard';
import { CurrentUserGuard } from './guards/current-user.guard';
import { AccountManagerPermission } from '@cacic/shared-types';
import { AccountPermissionService } from './services/account-permission.service';
import { clearCacicTrackingCookies } from '../privacy/tracking-cookie.utils';
import { createPkceChallenge } from './pkce.utils';
import { TotpService } from '../totp/totp.service';
import { redirectAfterSessionSave, saveSession } from './session-redirect.utils';
import { RedisService } from '../redis/redis.service';

const DATABASE_BACKED_ADMIN_MARKER = 'db-backed-admin' as const;
const DEFAULT_APPLICATION_ICON_URL = '/app/assets/default-app-icon.svg';

const resolveApplicationIconUrl = (attributes: Record<string, string> | undefined): string => {
  const logoUri = attributes?.['logoUri'] ?? attributes?.['logo_uri'];
  const normalizedLogoUri = logoUri?.trim();
  return normalizedLogoUri || DEFAULT_APPLICATION_ICON_URL;
};

export interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  cookie?: {
    maxAge: number | null;
  };
  oauthState?: string;
  oauthCodeVerifier?: string;
  redirectTo?: string;
  silentLogin?: boolean;
  accountLinkingState?: string;
  accountLinkingUserId?: string;
  accountLinkingCodeVerifier?: string;
  authenticatedAt?: number;
  save?: (callback: (err?: Error) => void) => void;
  regenerate?: (callback: (err?: Error) => void) => void;
  destroy: (callback: (err?: Error) => void) => void;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly appConfig!: AppConfig;
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
    private readonly accountPermissionService: AccountPermissionService,
    private readonly totpService: TotpService,
    private readonly redisService: RedisService,
  ) {
    this.appConfig = createAppConfig(this.configService);
  }

  /**
   * Constant-time string comparison to prevent timing attacks
   * @param a - First string to compare
   * @param b - Second string to compare
   * @returns true if strings are equal, false otherwise
   */
  private secureCompare(a: string, b: string): boolean {
    try {
      // Convert strings to buffers for constant-time comparison
      const bufferA = Buffer.from(a, 'utf-8');
      const bufferB = Buffer.from(b, 'utf-8');

      if (bufferA.length !== bufferB.length) {
        return false;
      }

      // Use crypto.timingSafeEqual for constant-time comparison
      return timingSafeEqual(bufferA, bufferB);
    } catch {
      return false;
    }
  }

  private resolveSafeReturnUrl(returnUrl?: string): string | null {
    if (!returnUrl) {
      return null;
    }

    const candidate = returnUrl.trim();
    if (!candidate) {
      return null;
    }

    if (candidate.startsWith('/')) {
      if (candidate.startsWith('//')) {
        return null;
      }

      try {
        return this.resolveFrontendPath(candidate);
      } catch {
        return null;
      }
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }
      if (parsed.username || parsed.password || parsed.hash || /%(?:2f|5c)/i.test(parsed.pathname)) {
        return null;
      }

      const allowed = this.appConfig.allowedRedirectUrls.some((allowedUrl) => {
        try {
          const configured = new URL(allowedUrl, this.appConfig.frontendUrl);
          if (configured.origin !== parsed.origin || configured.username || configured.password || configured.hash) {
            return false;
          }

          const allowedPath = configured.pathname.endsWith('/') ? configured.pathname : `${configured.pathname}/`;
          const allowedRoot = allowedPath === '/' ? '/' : allowedPath.slice(0, -1);
          return allowedRoot === '/' || parsed.pathname === allowedRoot || parsed.pathname.startsWith(allowedPath);
        } catch {
          return false;
        }
      });

      return allowed ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  private resolveFrontendPath(path: string): string {
    const frontendUrl = new URL(this.appConfig.frontendUrl);
    const basePath = frontendUrl.pathname.endsWith('/') ? frontendUrl.pathname : `${frontendUrl.pathname}/`;
    const baseRoot = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;

    if (basePath !== '/' && path !== baseRoot && !path.startsWith(basePath)) {
      const pathWithoutLeadingSlash = path.replace(/^\/+/, '');
      return new URL(`${basePath}${pathWithoutLeadingSlash}`, frontendUrl.origin).toString();
    }

    if (basePath !== '/' && path === baseRoot) {
      return new URL(basePath, frontendUrl.origin).toString();
    }

    return new URL(path, frontendUrl.origin).toString();
  }

  private authCallbackUrl(): string {
    return `${this.appConfig.apiBaseUrl}/auth/callback`;
  }

  private resolveSafePostLogoutRedirectUri(postLogoutRedirectUri?: string): string {
    const resolvedUrl =
      this.resolveSafeReturnUrl(postLogoutRedirectUri) ?? new URL(this.appConfig.frontendUrl).toString();

    const normalizedUrl = new URL(resolvedUrl);
    normalizedUrl.username = '';
    normalizedUrl.password = '';
    normalizedUrl.hash = '';
    return normalizedUrl.toString();
  }

  private applyKeycloakSessionLifetime(
    session: AuthSession,
    tokens: Awaited<ReturnType<KeycloakService['exchangeCodeForTokens']>>,
  ): void {
    if (!session.cookie) {
      return;
    }

    const sessionExpiresAt = this.resolveKeycloakSessionExpiresAt(tokens);
    if (!sessionExpiresAt) {
      return;
    }

    session.cookie.maxAge = Math.max(sessionExpiresAt - Date.now(), 0);
  }

  private resolveKeycloakSessionExpiresAt(
    tokens: Awaited<ReturnType<KeycloakService['exchangeCodeForTokens']>>,
  ): number | null {
    if (
      typeof tokens.refresh_expires_in === 'number' &&
      Number.isFinite(tokens.refresh_expires_in) &&
      tokens.refresh_expires_in > 0
    ) {
      return Date.now() + tokens.refresh_expires_in * 1000;
    }

    const refreshTokenExpiresAt = this.resolveJwtExpiresAt(tokens.refresh_token);
    if (refreshTokenExpiresAt) {
      return refreshTokenExpiresAt;
    }

    if (typeof tokens.expires_in === 'number' && Number.isFinite(tokens.expires_in) && tokens.expires_in > 0) {
      return Date.now() + tokens.expires_in * 1000;
    }

    return this.resolveJwtExpiresAt(tokens.access_token);
  }

  private resolveJwtExpiresAt(token?: string): number | null {
    if (!token) {
      return null;
    }

    const [, payload] = token.split('.');
    if (!payload) {
      return null;
    }

    try {
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { exp?: unknown };

      return typeof claims.exp === 'number' && Number.isFinite(claims.exp) ? claims.exp * 1000 : null;
    } catch {
      return null;
    }
  }

  private async createSessionFromKeycloakUser(
    session: AuthSession,
    tokens: Awaited<ReturnType<KeycloakService['exchangeCodeForTokens']>>,
    keycloakUser: KeycloakUser,
    context: string,
  ): Promise<SessionUser> {
    this.logger.debug(`${context} - received Keycloak identity`, { userId: keycloakUser.sub });

    let user = await this.userService.findByKeycloakId(keycloakUser.sub);
    if (!user) {
      user = await this.userService.createFromKeycloak(keycloakUser);
    } else {
      user = await this.userService.updateFromKeycloakOAuth(keycloakUser);
    }

    user = await this.userService.findByKeycloakId(keycloakUser.sub);

    if (!user) {
      throw new HttpException('Failed to create or find user', HttpStatus.INTERNAL_SERVER_ERROR);
    }

    await this.ensureDefaultTotpSeed(user);

    let isOnboarded = user.isOnboarded;

    try {
      const onboardingStatus = await this.userService.checkOnboardingStatus(user.keycloakId);

      isOnboarded = user.isOnboarded && !onboardingStatus.needsOnboarding;
      this.logger.debug(`${context} - user onboarding status`, {
        userId: user.keycloakId,
        userIsOnboarded: user.isOnboarded,
        onboardingStatusNeedsOnboarding: onboardingStatus.needsOnboarding,
        finalIsOnboarded: isOnboarded,
      });
    } catch (error) {
      if (error instanceof KeycloakConnectionException) {
        this.logger.error(`${context} - Keycloak connection error during onboarding check`, error);
        isOnboarded = false;
      } else {
        this.logger.error(`${context} - error checking onboarding status`, error);
      }
    }

    await this.regenerateSession(session);
    session.user = {
      email: user.email,
      keycloakId: user.keycloakId,
      isOnboarded,
    };
    session.accessToken = tokens.access_token;
    session.refreshToken = tokens.refresh_token;
    session.idToken = tokens.id_token;
    session.authenticatedAt = Date.now();
    this.applyKeycloakSessionLifetime(session, tokens);

    return session.user;
  }

  private async ensureDefaultTotpSeed(user: UserProfile): Promise<void> {
    try {
      await this.totpService.getOrCreateSeed({
        keycloakId: user.keycloakId,
        primaryEmail: user.email,
        displayName: user.displayName || user.fullname || null,
      });
    } catch (error) {
      this.logger.warn('Failed to prepare default TOTP seed during login', {
        userId: user.keycloakId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  private isPasswordLoginEnabled(): boolean {
    if (process.env.NODE_ENV === 'production') {
      return false;
    }

    const configured =
      this.configService.get<string>('KEYCLOAK_PASSWORD_LOGIN_ENABLED') ?? process.env.KEYCLOAK_PASSWORD_LOGIN_ENABLED;

    return configured !== undefined && ['1', 'true', 'yes', 'on'].includes(configured.trim().toLowerCase());
  }

  private resolvePostLoginRedirectUrl(isOnboarded: boolean, requestedReturnUrl?: string): string {
    const returnUrl = this.resolveSafeReturnUrl(requestedReturnUrl);

    if (isOnboarded && returnUrl) {
      return returnUrl;
    }

    return this.resolveFrontendPath(isOnboarded ? '/applications' : '/onboarding');
  }

  private regenerateSession(session: AuthSession): Promise<void> {
    if (!session.regenerate) {
      throw new ServiceUnavailableException('Unable to establish a secure authenticated session.');
    }

    return new Promise((resolve, reject) => {
      session.regenerate!((error) => (error ? reject(error) : resolve()));
    });
  }

  private async consumePasswordLoginAttempt(email: string, request: Request): Promise<void> {
    const source = request.ip || request.socket.remoteAddress || 'unknown';
    const allowedSources = (
      this.configService.get<string>('KEYCLOAK_PASSWORD_LOGIN_ALLOWED_IPS') || '127.0.0.1,::1,::ffff:127.0.0.1'
    )
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean);

    if (!allowedSources.includes(source)) {
      throw new HttpException('Password login is not available from this network.', HttpStatus.FORBIDDEN);
    }

    const digest = (value: string) => createHash('sha256').update(value).digest('hex');
    const windowSeconds = 5 * 60;

    try {
      const [emailAttempts, sourceAttempts] = await Promise.all([
        this.redisService.incrementWithExpiry(`auth:password-login:email:${digest(email)}`, windowSeconds),
        this.redisService.incrementWithExpiry(`auth:password-login:source:${digest(source)}`, windowSeconds),
      ]);

      if (emailAttempts > 5 || sourceAttempts > 20) {
        throw new HttpException('Too many login attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Unable to enforce password-login rate limit', error);
      throw new ServiceUnavailableException('Password login is temporarily unavailable.');
    }
  }

  @ApiOperation({
    summary: 'Initiate OAuth login',
    description: 'Redirects to Keycloak login page to start OAuth flow',
  })
  @ApiQuery({
    name: 'ru',
    description: 'Optional post-login return URL. Must be a relative path or allowed origin.',
    required: false,
    example: 'https://other-app.example.com/path',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Keycloak login page',
  })
  @SkipCsrf()
  @Get('login')
  async login(
    @Query('ru') shortReturnUrl: string,
    @Query('return_url') legacyReturnUrl: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ): Promise<void> {
    await this.startLoginFlow({
      shortReturnUrl,
      legacyReturnUrl,
      session,
      response: res,
      routeName: 'login',
    });
  }

  @ApiOperation({
    summary: 'Redirect to OAuth login',
    description:
      'Compatibility route aligned with sibling CACiC apps. Redirects to Keycloak login and stores the post-login return path in the Account Manager session.',
  })
  @ApiQuery({
    name: 'returnTo',
    description: 'Optional post-login return URL. Must be a relative path or allowed origin.',
    required: false,
    example: '/app/applications',
  })
  @ApiQuery({
    name: 'prompt',
    description: 'OIDC prompt value. Use prompt=none for silent SSO checks.',
    required: false,
    example: 'none',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Keycloak login page',
  })
  @SkipCsrf()
  @Get('login/redirect')
  async redirectToLogin(
    @Query('returnTo') returnTo: string,
    @Query('prompt') prompt: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ): Promise<void> {
    await this.startLoginFlow({
      shortReturnUrl: returnTo,
      legacyReturnUrl: undefined,
      session,
      response: res,
      routeName: 'login redirect',
      prompt: prompt === 'none' ? 'none' : undefined,
    });
  }

  private async startLoginFlow({
    shortReturnUrl,
    legacyReturnUrl,
    session,
    response,
    routeName,
    prompt,
  }: {
    shortReturnUrl?: string;
    legacyReturnUrl?: string;
    session: AuthSession;
    response: Response;
    routeName: string;
    prompt?: 'none';
  }): Promise<void> {
    const redirectUri = this.authCallbackUrl();

    // Generate cryptographically secure random state token for CSRF protection
    const state = randomBytes(32).toString('hex');
    const pkce = createPkceChallenge();

    // Store state in session for validation in callback
    session.oauthState = state;
    session.oauthCodeVerifier = pkce.verifier;
    session.silentLogin = prompt === 'none';

    const requestedReturnUrl = shortReturnUrl || legacyReturnUrl;
    const safeReturnUrl = this.resolveSafeReturnUrl(requestedReturnUrl);

    if (safeReturnUrl) {
      session.redirectTo = safeReturnUrl;
    } else {
      delete session.redirectTo;
      if (requestedReturnUrl) {
        this.logger.warn(`Blocked unsafe return URL during ${routeName}`, {
          reason: 'URL origin not in ALLOWED_REDIRECT_URLS config',
        });
      }
    }

    const authUrl = this.keycloakService.getAuthUrl(redirectUri, state, {
      ...(prompt ? { prompt } : {}),
      codeChallenge: pkce.challenge,
    });
    await redirectAfterSessionSave(session, response, authUrl);
  }

  @ApiOperation({
    summary: 'Attempt silent OAuth login',
    description:
      'Redirects to Keycloak with prompt=none so existing SSO sessions can authenticate without showing a login screen.',
  })
  @ApiQuery({
    name: 'ru',
    description: 'Optional post-login return URL. Must be a relative path or allowed origin.',
    required: false,
    example: '/applications',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Keycloak for silent SSO or back to the application when no SSO session exists',
  })
  @SkipCsrf()
  @Get('silent-login')
  async silentLogin(
    @Query('ru') shortReturnUrl: string,
    @Query('return_url') legacyReturnUrl: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ): Promise<void> {
    const redirectUri = this.authCallbackUrl();
    const state = randomBytes(32).toString('hex');
    const pkce = createPkceChallenge();
    const requestedReturnUrl = shortReturnUrl || legacyReturnUrl;
    const safeReturnUrl = this.resolveSafeReturnUrl(requestedReturnUrl);

    session.oauthState = state;
    session.oauthCodeVerifier = pkce.verifier;
    session.silentLogin = true;

    if (safeReturnUrl) {
      session.redirectTo = safeReturnUrl;
    } else {
      delete session.redirectTo;
      if (requestedReturnUrl) {
        this.logger.warn('Blocked unsafe return URL during silent login', {
          reason: 'URL origin not in ALLOWED_REDIRECT_URLS config',
        });
      }
    }

    const authUrl = this.keycloakService.getAuthUrl(redirectUri, state, {
      prompt: 'none',
      codeChallenge: pkce.challenge,
    });
    await redirectAfterSessionSave(session, res, authUrl);
  }

  @ApiOperation({
    summary: 'Development password login',
    description:
      'Authenticates with email and password through Keycloak direct access grants. Disabled by default, restricted by source, and controlled by KEYCLOAK_PASSWORD_LOGIN_ENABLED.',
  })
  @ApiBody({
    type: PasswordLoginDto,
    description: 'Development login credentials',
  })
  @ApiResponse({
    status: 200,
    description: 'Password login completed',
    type: PasswordLoginResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid email or password',
  })
  @ApiResponse({
    status: 403,
    description: 'Password login is disabled',
  })
  @HttpCode(HttpStatus.OK)
  @Post('password-login')
  async passwordLogin(
    @Body() body: PasswordLoginDto,
    @Session() session: AuthSession,
    @Req() request: Request,
  ): Promise<PasswordLoginResponseDto> {
    if (!this.isPasswordLoginEnabled()) {
      throw new HttpException(
        process.env.NODE_ENV === 'production' ? 'Not found' : 'Password login is disabled',
        process.env.NODE_ENV === 'production' ? HttpStatus.NOT_FOUND : HttpStatus.FORBIDDEN,
      );
    }

    const email = body.email.trim().toLowerCase();
    await this.consumePasswordLoginAttempt(email, request);

    try {
      const tokens = await this.keycloakService.exchangePasswordForTokens(email, body.password);
      const keycloakUser = await this.keycloakService.getUserInfo(tokens.access_token);
      const sessionUser = await this.createSessionFromKeycloakUser(session, tokens, keycloakUser, 'Password login');

      const redirectUrl = this.resolvePostLoginRedirectUrl(sessionUser.isOnboarded, body.returnTo);

      if (sessionUser.isOnboarded) {
        delete session.redirectTo;
      }

      await saveSession(session);

      return {
        success: true,
        isAuthenticated: true,
        isOnboarded: sessionUser.isOnboarded,
        redirectUrl,
      };
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      this.logger.warn('Password login failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw new HttpException('Invalid email or password', HttpStatus.UNAUTHORIZED);
    }
  }

  @ApiOperation({
    summary: 'OAuth callback',
    description: 'Handles OAuth callback from Keycloak, exchanges code for tokens, and creates/updates user',
  })
  @ApiQuery({
    name: 'code',
    description: 'Authorization code from OAuth provider',
    required: true,
    example: 'abc123def456',
  })
  @ApiQuery({
    name: 'state',
    description: 'State parameter for CSRF protection',
    required: true,
    example: 'random-state-string',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to frontend application or onboarding page',
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Authorization code missing',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid or missing state parameter (CSRF protection)',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error - Failed to process OAuth callback',
  })
  @SkipCsrf()
  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') oauthError: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ) {
    try {
      if (oauthError) {
        if (!state || !session.oauthState || !this.secureCompare(state, session.oauthState)) {
          this.logger.warn('OAuth error callback CSRF validation failed', {
            stateProvided: !!state,
            sessionStateExists: !!session.oauthState,
          });
          throw new HttpException('Invalid or missing state parameter', HttpStatus.FORBIDDEN);
        }

        const wasSilentLogin = !!session.silentLogin;
        const returnUrl = this.resolveSafeReturnUrl(session.redirectTo);
        delete session.oauthState;
        delete session.oauthCodeVerifier;
        delete session.silentLogin;
        delete session.redirectTo;

        if (wasSilentLogin) {
          const fallbackUrl = new URL(returnUrl || this.appConfig.frontendUrl);
          fallbackUrl.searchParams.set('sso', 'none');
          await redirectAfterSessionSave(session, res, fallbackUrl.toString());
          return;
        }

        this.logger.warn('OAuth callback returned an error', {
          error: oauthError,
        });
        await redirectAfterSessionSave(session, res, this.resolveFrontendPath('/login?error=auth_failed'));
        return;
      }

      if (!code) {
        throw new HttpException('Authorization code missing', HttpStatus.BAD_REQUEST);
      }

      // CSRF Protection: Validate state parameter
      if (!state || !session.oauthState) {
        this.logger.warn('OAuth callback CSRF validation failed', {
          stateProvided: !!state,
          sessionStateExists: !!session.oauthState,
        });
        throw new HttpException('Invalid or missing state parameter', HttpStatus.FORBIDDEN);
      }

      // Use constant-time comparison to prevent timing attacks
      if (!this.secureCompare(state, session.oauthState)) {
        this.logger.warn('OAuth callback state mismatch', {
          stateProvided: true,
          sessionStateExists: true,
        });
        throw new HttpException('State parameter mismatch', HttpStatus.FORBIDDEN);
      }

      // Clear the state from session after successful validation
      const codeVerifier = session.oauthCodeVerifier;
      const requestedReturnUrl = this.resolveSafeReturnUrl(session.redirectTo);
      delete session.oauthState;
      delete session.oauthCodeVerifier;
      delete session.silentLogin;

      const redirectUri = this.authCallbackUrl();
      const tokens = await this.keycloakService.exchangeCodeForTokens(code, redirectUri, codeVerifier);
      const keycloakUser = await this.keycloakService.getUserInfo(tokens.access_token);
      const sessionUser = await this.createSessionFromKeycloakUser(session, tokens, keycloakUser, 'OAuth callback');
      const redirectUrl = this.resolvePostLoginRedirectUrl(sessionUser.isOnboarded, requestedReturnUrl ?? undefined);

      await redirectAfterSessionSave(session, res, redirectUrl);
      return;
    } catch (error) {
      delete session.redirectTo;
      delete session.oauthState;
      delete session.oauthCodeVerifier;
      delete session.silentLogin;
      this.logger.error('Auth callback error', error);
      await redirectAfterSessionSave(session, res, this.resolveFrontendPath('/login?error=auth_failed'));
    }
  }

  @ApiOperation({
    summary: 'Get current user',
    description: 'Returns the profile information of the currently authenticated user',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user profile',
    type: UserProfileDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - User profile not found',
  })
  @ApiResponse({
    status: 503,
    description: 'Service Unavailable - Unable to connect to authentication service',
  })
  @Auth()
  @SkipCsrf()
  @Get('me')
  async getCurrentUser(@Session() session: AuthSession) {
    const user = await this.userService.findById(session.user!.keycloakId);
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    try {
      // Always check current onboarding status to ensure accuracy
      const onboardingStatus = await this.userService.checkOnboardingStatus(user.keycloakId);

      const userDto = await this.userService.toDto(user);
      // Override the isOnboarded status with the current check result
      userDto.isOnboarded = !onboardingStatus.needsOnboarding;

      // Update session to match current status
      if (session.user!.isOnboarded !== userDto.isOnboarded) {
        session.user!.isOnboarded = userDto.isOnboarded;
      }

      return userDto;
    } catch (error) {
      // For connection errors, throw them so the client gets a proper error response
      if (error instanceof KeycloakConnectionException) {
        this.logger.error('Keycloak connection error in getCurrentUser', error);
        throw error;
      }

      // For other errors, fallback to the user's stored onboarding status
      this.logger.error('Error checking onboarding status in getCurrentUser', error);
      const userDto = await this.userService.toDto(user);
      // Keep the existing session status as fallback
      userDto.isOnboarded = session.user!.isOnboarded;
      return userDto;
    }
  }

  @ApiOperation({
    summary: 'Update user profile',
    description: 'Updates user profile information and completes onboarding if all required fields are provided',
  })
  @ApiBody({
    type: CreateUserProfileDto,
    description: 'User profile data to update',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated user profile',
    type: UserProfileDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid input data',
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
  @Post('profile')
  async updateProfile(@Body() updateData: CreateUserProfileDto, @Session() session: AuthSession) {
    const updatedUser = await this.userService.updateProfile(session.user!.keycloakId, updateData);

    if (session.user) {
      session.user.isOnboarded = updatedUser.isOnboarded;
    }

    return this.userService.toDto(updatedUser);
  }

  @ApiOperation({
    summary: 'Consume post-onboarding redirect',
    description: 'Returns and clears the pending post-login redirect URL after onboarding is completed.',
  })
  @ApiResponse({
    status: 200,
    description: 'Pending redirect consumed successfully',
    schema: {
      type: 'object',
      properties: {
        redirectUrl: {
          type: 'string',
          nullable: true,
          description: 'Validated redirect URL or null when no redirect is pending',
        },
      },
    },
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
  @UseGuards(CsrfGuard)
  @Post('post-onboarding-redirect')
  consumePostOnboardingRedirect(@Session() session: AuthSession): {
    redirectUrl: string | null;
  } {
    if (!session.user?.isOnboarded) {
      return { redirectUrl: null };
    }

    if (session.redirectTo && !this.resolveSafeReturnUrl(session.redirectTo)) {
      this.logger.warn('Post-onboarding redirect URL failed validation', {
        userId: session.user?.keycloakId,
        attemptedUrl: session.redirectTo,
        allowedOrigins: this.appConfig.allowedRedirectUrls,
      });
    }

    const redirectUrl = this.resolveSafeReturnUrl(session.redirectTo);
    delete session.redirectTo;

    return { redirectUrl };
  }

  @ApiOperation({
    summary: 'Logout user',
    description: 'Logs out the user by destroying the session and invalidating tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
    type: LogoutResponseDto,
  })
  @ApiBody({
    type: LogoutRequestDto,
    required: false,
    description: 'Optional logout redirect target. Must be a relative path or allowed origin.',
  })
  @Auth()
  @UseGuards(CurrentUserGuard)
  @Post('logout')
  logout(@Session() session: AuthSession, @Body() body: LogoutRequestDto | undefined, @Res() res: Response) {
    const logoutUrl = this.keycloakService.getEndSessionUrl(
      this.resolveSafePostLogoutRedirectUri(body?.postLogoutRedirectUri),
      session.idToken,
    );

    clearCacicTrackingCookies(res, this.configService);
    res.clearCookie('connect.sid', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
    });

    session.destroy((err: unknown) => {
      if (err) {
        this.logger.error('Session destruction error', err);
        res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
          success: false,
          logoutUrl,
          message: 'The browser session was cleared, but server-side revocation could not be confirmed.',
        });
        return;
      }
      res.json({ success: true, logoutUrl });
    });
  }

  @ApiOperation({
    summary: 'Check authentication status',
    description: 'Returns the current authentication and onboarding status of the user',
  })
  @ApiResponse({
    status: 200,
    description: 'Authentication status',
    type: AuthStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 503,
    description: 'Service Unavailable - Unable to connect to authentication service',
  })
  @Auth()
  @SkipCsrf()
  @Get('check')
  async checkAuth(@Session() session: AuthSession) {
    // Always check current onboarding status from Keycloak to ensure accuracy
    try {
      const onboardingStatus = await this.userService.checkOnboardingStatus(
        session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      );

      const currentIsOnboarded = !onboardingStatus.needsOnboarding;

      // Update session if onboarding status has changed
      if (session.user!.isOnboarded !== currentIsOnboarded) {
        this.logger.debug('Updating session onboarding status', {
          userId: session.user!.keycloakId,
          previousStatus: session.user!.isOnboarded,
          currentStatus: currentIsOnboarded,
        });
        session.user!.isOnboarded = currentIsOnboarded;
      }

      this.logger.debug('Auth check for user', {
        userId: session.user!.keycloakId,
        sessionIsOnboarded: session.user!.isOnboarded,
        actualIsOnboarded: currentIsOnboarded,
      });

      return {
        isAuthenticated: true,
        isOnboarded: currentIsOnboarded,
      };
    } catch (error) {
      // For connection errors, throw them so the client gets a proper error response
      if (error instanceof KeycloakConnectionException) {
        this.logger.error('Keycloak connection error during auth check', error);
        throw error;
      }

      this.logger.error('Error checking onboarding status in auth check', error);
      // For other errors, fallback to session data
      return {
        isAuthenticated: true,
        isOnboarded: session.user!.isOnboarded,
      };
    }
  }

  @ApiOperation({
    summary: 'Check Unesp role requirement',
    description: 'Checks if the authenticated user should see Unesp role selection during onboarding.',
  })
  @ApiResponse({
    status: 200,
    description: 'Unesp role requirement status',
    type: UnespRoleRequiredDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @SkipCsrf()
  @Get('unesp-role-required')
  async checkUnespRoleRequired(@Session() session: AuthSession) {
    const shouldShow = await this.userService.shouldShowUnespRoleSelection(
      session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
    );

    return { shouldShowUnespRoleSelection: shouldShow };
  }

  @ApiOperation({
    summary: 'Get onboarding status',
    description: 'Returns detailed onboarding status including missing fields for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'Onboarding status details',
    type: OnboardingStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 503,
    description: 'Service Unavailable - Unable to connect to authentication service',
  })
  @Auth()
  @SkipCsrf()
  @Get('onboarding-status')
  async getOnboardingStatus(@Session() session: AuthSession) {
    try {
      const onboardingStatus = await this.userService.checkOnboardingStatus(
        session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      );

      return onboardingStatus;
    } catch (error) {
      // If it's a connection error, return a 503 Service Unavailable with a clear message
      if (error instanceof KeycloakConnectionException) {
        throw error; // Re-throw the already properly formatted exception
      }

      // For other errors, return a generic server error
      this.logger.error('Unexpected error checking onboarding status', error);
      throw new HttpException('Unable to verify user onboarding status', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @ApiOperation({
    summary: 'Get user applications',
    description: 'Returns a list of applications available to the authenticated user from Keycloak.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user applications',
    type: [UserApplicationDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error - Failed to retrieve applications',
  })
  @Auth()
  @SkipCsrf()
  @Get('applications')
  async getUserApplications(@Session() session: AuthSession) {
    try {
      const keycloakApps = await this.keycloakService.getUserApplications(
        session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      );

      // Convert Keycloak applications to user-friendly format
      const applications = keycloakApps.map((app) => ({
        id: app.id,
        name: app.name || app.clientId,
        description: app.description || `Access ${app.name || app.clientId}`,
        url: app.baseUrl || app.adminUrl,
        iconUrl: resolveApplicationIconUrl(app.attributes),
        category: app.attributes?.['category'] || 'Application',
        enabled: app.enabled,
      }));

      this.logger.debug('Returning applications for user', {
        userId: session.user!.keycloakId,
        applicationsCount: applications.length,
      });

      return applications;
    } catch (error) {
      this.logger.error('Error getting user applications', error);
      throw new HttpException('Failed to retrieve applications', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @ApiOperation({
    summary: 'Check admin status',
    description:
      'Check if the current user has Account Manager admin privileges from database-backed permission grants, including the Keycloak bootstrap super-admin fallback.',
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
        adminGroups: {
          type: 'array',
          items: { type: 'string' },
          uniqueItems: true,
          oneOf: [
            {
              type: 'array',
              items: { type: 'string' },
              example: [AccountManagerPermission.SuperAdmin],
            },
            {
              type: 'array',
              items: { type: 'string' },
              example: [DATABASE_BACKED_ADMIN_MARKER],
            },
            {
              type: 'array',
              items: { type: 'string' },
              example: [],
            },
          ],
          description:
            'Account Manager admin permission marker returned for the user. The controller returns either the super-admin marker, the database-backed admin marker, or an empty array.',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @SkipCsrf()
  @Get('admin-status')
  async getAdminStatus(@Session() session: AuthSession) {
    try {
      const userId = session.user?.keycloakId;
      if (!userId) {
        return {
          isAdmin: false,
          adminGroups: [],
        };
      }

      const hasSuperAdminAccess = await this.accountPermissionService.hasAccountManagerSuperAdminAccess(userId);
      const isAdmin = hasSuperAdminAccess || (await this.accountPermissionService.hasAccountManagerAdminAccess(userId));
      const adminGroups = hasSuperAdminAccess
        ? [AccountManagerPermission.SuperAdmin]
        : isAdmin
          ? [DATABASE_BACKED_ADMIN_MARKER]
          : [];

      this.logger.debug('Admin status check for user', {
        userId,
        adminGroups,
        isAdmin,
      });

      return {
        isAdmin,
        adminGroups,
      };
    } catch (error) {
      this.logger.error('Error checking admin status', error);
      throw new ServiceUnavailableException('Unable to determine administrator status.');
    }
  }
}
