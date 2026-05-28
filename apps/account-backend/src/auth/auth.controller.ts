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
  UseGuards,
  Logger,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiQuery,
  ApiBody,
} from '@nestjs/swagger';
import { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { randomBytes, timingSafeEqual } from 'crypto';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { KeycloakConnectionException } from './exceptions/keycloak-connection.exception';
import { Auth } from './guards/auth.decorator';
import {
  CreateUserProfileDto,
  UserProfileDto,
  AuthStatusDto,
  OnboardingStatusDto,
  UnespRoleRequiredDto,
  UserApplicationDto,
  LogoutResponseDto,
} from './dto/user-profile.dto';
import { SessionUser } from './interfaces/auth.interface';
import { createAppConfig, AppConfig } from '../config/app.config';
import { CsrfGuard, SkipCsrf } from './csrf/csrf.guard';
import { CurrentUserGuard } from './guards/current-user.guard';
import { hasRequiredKeycloakRoles } from './guards/keycloak-role.guard';

export interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  idToken?: string;
  oauthState?: string;
  redirectTo?: string;
  silentLogin?: boolean;
  accountLinkingState?: string;
  accountLinkingUserId?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  private readonly appConfig: AppConfig;
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly keycloakService: KeycloakService,
    private readonly userService: UserService,
    private readonly configService: ConfigService,
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
        return new URL(candidate, this.appConfig.frontendUrl).toString();
      } catch {
        return null;
      }
    }

    try {
      const parsed = new URL(candidate);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return null;
      }

      const allowedOrigins = this.appConfig.allowedRedirectUrls
        .map((allowedUrl) => {
          try {
            return new URL(allowedUrl, this.appConfig.frontendUrl).origin;
          } catch {
            return null;
          }
        })
        .filter((origin): origin is string => origin !== null);

      return allowedOrigins.includes(parsed.origin) ? parsed.toString() : null;
    } catch {
      return null;
    }
  }

  @ApiOperation({
    summary: 'Initiate OAuth login',
    description: 'Redirects to Keycloak login page to start OAuth flow',
  })
  @ApiQuery({
    name: 'ru',
    description:
      'Optional post-login return URL. Must be a relative path or allowed origin.',
    required: false,
    example: 'https://other-app.example.com/path',
  })
  @ApiResponse({
    status: 302,
    description: 'Redirects to Keycloak login page',
  })
  @SkipCsrf()
  @Get('login')
  login(
    @Query('ru') shortReturnUrl: string,
    @Query('return_url') legacyReturnUrl: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ) {
    const redirectUri = `${this.appConfig.backendUrl}/auth/callback`;

    // Generate cryptographically secure random state token for CSRF protection
    const state = randomBytes(32).toString('hex');

    // Store state in session for validation in callback
    session.oauthState = state;

    const requestedReturnUrl = shortReturnUrl || legacyReturnUrl;
    const safeReturnUrl = this.resolveSafeReturnUrl(requestedReturnUrl);

    if (safeReturnUrl) {
      session.redirectTo = safeReturnUrl;
    } else {
      delete session.redirectTo;
      if (requestedReturnUrl) {
        this.logger.warn('Blocked unsafe return URL during login', {
          requestedUrl: requestedReturnUrl,
          reason: 'URL origin not in ALLOWED_REDIRECT_URLS config',
          allowedOrigins: this.appConfig.allowedRedirectUrls,
        });
      }
    }

    const authUrl = this.keycloakService.getAuthUrl(redirectUri, state);
    res.redirect(authUrl);
  }

  @ApiOperation({
    summary: 'Attempt silent OAuth login',
    description:
      'Redirects to Keycloak with prompt=none so existing SSO sessions can authenticate without showing a login screen.',
  })
  @ApiQuery({
    name: 'ru',
    description:
      'Optional post-login return URL. Must be a relative path or allowed origin.',
    required: false,
    example: '/applications',
  })
  @ApiResponse({
    status: 302,
    description:
      'Redirects to Keycloak for silent SSO or back to the application when no SSO session exists',
  })
  @SkipCsrf()
  @Get('silent-login')
  silentLogin(
    @Query('ru') shortReturnUrl: string,
    @Query('return_url') legacyReturnUrl: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ) {
    const redirectUri = `${this.appConfig.backendUrl}/auth/callback`;
    const state = randomBytes(32).toString('hex');
    const requestedReturnUrl = shortReturnUrl || legacyReturnUrl;
    const safeReturnUrl = this.resolveSafeReturnUrl(requestedReturnUrl);

    session.oauthState = state;
    session.silentLogin = true;

    if (safeReturnUrl) {
      session.redirectTo = safeReturnUrl;
    } else {
      delete session.redirectTo;
      if (requestedReturnUrl) {
        this.logger.warn('Blocked unsafe return URL during silent login', {
          requestedUrl: requestedReturnUrl,
          reason: 'URL origin not in ALLOWED_REDIRECT_URLS config',
          allowedOrigins: this.appConfig.allowedRedirectUrls,
        });
      }
    }

    const authUrl = this.keycloakService.getAuthUrl(redirectUri, state, {
      prompt: 'none',
    });
    res.redirect(authUrl);
  }

  @ApiOperation({
    summary: 'OAuth callback',
    description:
      'Handles OAuth callback from Keycloak, exchanges code for tokens, and creates/updates user',
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
    description:
      'Forbidden - Invalid or missing state parameter (CSRF protection)',
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
        if (
          !state ||
          !session.oauthState ||
          !this.secureCompare(state, session.oauthState)
        ) {
          this.logger.warn('OAuth error callback CSRF validation failed', {
            stateProvided: !!state,
            sessionStateExists: !!session.oauthState,
          });
          throw new HttpException(
            'Invalid or missing state parameter',
            HttpStatus.FORBIDDEN,
          );
        }

        const wasSilentLogin = !!session.silentLogin;
        const returnUrl = this.resolveSafeReturnUrl(session.redirectTo);
        delete session.oauthState;
        delete session.silentLogin;
        delete session.redirectTo;

        if (wasSilentLogin) {
          const fallbackUrl = new URL(returnUrl || this.appConfig.frontendUrl);
          fallbackUrl.searchParams.set('sso', 'none');
          res.redirect(fallbackUrl.toString());
          return;
        }

        this.logger.warn('OAuth callback returned an error', {
          error: oauthError,
        });
        res.redirect(`${this.appConfig.frontendUrl}login?error=auth_failed`);
        return;
      }

      if (!code) {
        throw new HttpException(
          'Authorization code missing',
          HttpStatus.BAD_REQUEST,
        );
      }

      // CSRF Protection: Validate state parameter
      if (!state || !session.oauthState) {
        this.logger.warn('OAuth callback CSRF validation failed', {
          stateProvided: !!state,
          sessionStateExists: !!session.oauthState,
        });
        throw new HttpException(
          'Invalid or missing state parameter',
          HttpStatus.FORBIDDEN,
        );
      }

      // Use constant-time comparison to prevent timing attacks
      if (!this.secureCompare(state, session.oauthState)) {
        this.logger.warn('OAuth callback state mismatch', {
          receivedState: state.substring(0, 10) + '...',
          expectedState: session.oauthState.substring(0, 10) + '...',
        });
        throw new HttpException(
          'State parameter mismatch',
          HttpStatus.FORBIDDEN,
        );
      }

      // Clear the state from session after successful validation
      delete session.oauthState;
      delete session.silentLogin;

      const redirectUri = `${this.appConfig.backendUrl}/auth/callback`;
      const tokens = await this.keycloakService.exchangeCodeForTokens(
        code,
        redirectUri,
      );
      const keycloakUser = await this.keycloakService.getUserInfo(
        tokens.access_token,
      );

      this.logger.debug('Auth callback - Keycloak user data', {
        sub: keycloakUser.sub,
        email: keycloakUser.email,
        name: keycloakUser.name,
        picture: keycloakUser.picture,
        hasPicture: !!keycloakUser.picture,
      });

      let user = await this.userService.findByKeycloakId(keycloakUser.sub);
      if (!user) {
        user = await this.userService.createFromKeycloak(keycloakUser);
      } else {
        // Update existing user with latest OAuth data (picture, display name, etc.)
        user = await this.userService.updateFromKeycloakOAuth(keycloakUser);
      }

      // Always refresh user data to get the latest onboarding status
      user = await this.userService.findByKeycloakId(keycloakUser.sub);

      if (!user) {
        throw new HttpException(
          'Failed to create or find user',
          HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }

      // Check actual onboarding status based on required attributes
      try {
        const onboardingStatus = await this.userService.checkOnboardingStatus(
          user.keycloakId,
        );

        this.logger.debug('Auth callback - user onboarding status', {
          userId: user.keycloakId,
          userIsOnboarded: user.isOnboarded,
          onboardingStatusNeedsOnboarding: onboardingStatus.needsOnboarding,
          finalIsOnboarded:
            user.isOnboarded && !onboardingStatus.needsOnboarding,
        });

        session.user = {
          id: user.id,
          email: user.email,
          keycloakId: user.keycloakId,
          isOnboarded: user.isOnboarded && !onboardingStatus.needsOnboarding,
        };
        session.accessToken = tokens.access_token;
        session.refreshToken = tokens.refresh_token;
        session.idToken = tokens.id_token;

        // Redirect to frontend based on actual onboarding status
        const needsOnboarding = !session.user.isOnboarded;
        const returnUrl = session.redirectTo;

        if (!needsOnboarding && returnUrl) {
          this.logger.debug('Redirecting user after callback to return_url', {
            returnUrl,
          });
          delete session.redirectTo;
          res.redirect(returnUrl);
          return;
        }

        const frontendUrl = needsOnboarding
          ? `${this.appConfig.frontendUrl}onboarding`
          : `${this.appConfig.frontendUrl}applications`;

        this.logger.debug('Redirecting user after callback', {
          frontendUrl,
          needsOnboarding,
        });
        if (!needsOnboarding) {
          delete session.redirectTo;
        }
        res.redirect(frontendUrl);
        return;
      } catch (error) {
        // For connection errors, assume the user needs onboarding to be safe
        // This prevents incorrectly redirecting already-onboarded users to the main app
        if (error instanceof KeycloakConnectionException) {
          this.logger.error(
            'Keycloak connection error during callback, redirecting to onboarding for safety',
            error,
          );

          session.user = {
            id: user.id,
            email: user.email,
            keycloakId: user.keycloakId,
            isOnboarded: false, // Safe default when we can't verify
          };
          session.accessToken = tokens.access_token;
          session.refreshToken = tokens.refresh_token;
          session.idToken = tokens.id_token;

          // Redirect to onboarding to be safe - the onboarding page will show an error
          res.redirect(`${this.appConfig.frontendUrl}onboarding`);
          return;
        }

        // For other errors, fall back to the user's stored onboarding status
        this.logger.error(
          'Error checking onboarding status during callback',
          error,
        );

        session.user = {
          id: user.id,
          email: user.email,
          keycloakId: user.keycloakId,
          isOnboarded: user.isOnboarded, // Use stored status as fallback
        };
        session.accessToken = tokens.access_token;
        session.refreshToken = tokens.refresh_token;
        session.idToken = tokens.id_token;

        const needsOnboarding = !session.user.isOnboarded;
        const returnUrl = session.redirectTo;

        if (!needsOnboarding && returnUrl) {
          this.logger.debug(
            'Redirecting user after callback fallback to return_url',
            {
              returnUrl,
            },
          );
          delete session.redirectTo;
          res.redirect(returnUrl);
          return;
        }

        const frontendUrl = needsOnboarding
          ? `${this.appConfig.frontendUrl}onboarding`
          : `${this.appConfig.frontendUrl}applications`;

        this.logger.debug('Redirecting user after callback fallback', {
          frontendUrl,
          needsOnboarding,
        });
        if (!needsOnboarding) {
          delete session.redirectTo;
        }
        res.redirect(frontendUrl);
        return;
      }
    } catch (error) {
      delete session.redirectTo;
      delete session.silentLogin;
      this.logger.error('Auth callback error', error);
      res.redirect(`${this.appConfig.frontendUrl}login?error=auth_failed`);
    }
  }

  @ApiOperation({
    summary: 'Get current user',
    description:
      'Returns the profile information of the currently authenticated user',
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
    description:
      'Service Unavailable - Unable to connect to authentication service',
  })
  @Auth()
  @SkipCsrf()
  @Get('me')
  async getCurrentUser(@Session() session: AuthSession) {
    const user = await this.userService.findById(session.user!.id); // Safe to use ! because AuthGuard ensures user exists
    if (!user) {
      throw new HttpException('User not found', HttpStatus.NOT_FOUND);
    }

    try {
      // Always check current onboarding status to ensure accuracy
      const onboardingStatus = await this.userService.checkOnboardingStatus(
        user.keycloakId,
      );

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
      this.logger.error(
        'Error checking onboarding status in getCurrentUser',
        error,
      );
      const userDto = await this.userService.toDto(user);
      // Keep the existing session status as fallback
      userDto.isOnboarded = session.user!.isOnboarded;
      return userDto;
    }
  }

  @ApiOperation({
    summary: 'Update user profile',
    description:
      'Updates user profile information and completes onboarding if all required fields are provided',
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
  async updateProfile(
    @Body() updateData: CreateUserProfileDto,
    @Session() session: AuthSession,
  ) {
    const updatedUser = await this.userService.updateProfile(
      session.user!.id, // Safe to use ! because AuthGuard ensures user exists
      updateData,
    );

    // Small delay to ensure Keycloak attributes are fully persisted
    await new Promise((resolve) => setTimeout(resolve, 100));

    try {
      // Check if onboarding is now complete
      const onboardingStatus = await this.userService.checkOnboardingStatus(
        session.user!.keycloakId,
      );

      // Update session
      if (session.user) {
        session.user.isOnboarded = !onboardingStatus.needsOnboarding;
      }

      // Ensure the returned user has the correct onboarding status
      const userDto = await this.userService.toDto(updatedUser);
      userDto.isOnboarded = !onboardingStatus.needsOnboarding;

      this.logger.debug('Profile updated for user', {
        userId: session.user!.keycloakId,
        onboardingStatus,
        userDtoIsOnboarded: userDto.isOnboarded,
        sessionIsOnboarded: session.user!.isOnboarded,
      });

      return userDto;
    } catch (error) {
      // For connection errors, throw them so the client gets a proper error response
      if (error instanceof KeycloakConnectionException) {
        this.logger.error(
          'Keycloak connection error after profile update',
          error,
        );
        throw error;
      }

      // For other errors, return the updated user with uncertain onboarding status
      this.logger.error(
        'Error checking onboarding status after profile update',
        error,
      );
      const userDto = await this.userService.toDto(updatedUser);
      // Keep existing session status as fallback
      userDto.isOnboarded = session.user!.isOnboarded;
      return userDto;
    }
  }

  @ApiOperation({
    summary: 'Consume post-onboarding redirect',
    description:
      'Returns and clears the pending post-login redirect URL after onboarding is completed.',
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
          description:
            'Validated redirect URL or null when no redirect is pending',
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
        userId: session.user?.id,
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
    description:
      'Logs out the user by destroying the session and invalidating tokens',
  })
  @ApiResponse({
    status: 200,
    description: 'Successfully logged out',
    type: LogoutResponseDto,
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Invalid CSRF token',
  })
  @Auth()
  @UseGuards(CsrfGuard)
  @Post('logout')
  async logout(@Session() session: AuthSession, @Res() res: Response) {
    try {
      if (session.refreshToken) {
        await this.keycloakService.logout(session.refreshToken);
      }
    } catch (error) {
      this.logger.error('Keycloak logout error', error);
    }

    session.destroy((err: unknown) => {
      if (err) {
        this.logger.error('Session destruction error', err);
      }
      res.json({ success: true });
    });
  }

  @ApiOperation({
    summary: 'Check authentication status',
    description:
      'Returns the current authentication and onboarding status of the user',
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
    description:
      'Service Unavailable - Unable to connect to authentication service',
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

      this.logger.error(
        'Error checking onboarding status in auth check',
        error,
      );
      // For other errors, fallback to session data
      return {
        isAuthenticated: true,
        isOnboarded: session.user!.isOnboarded,
      };
    }
  }

  @ApiOperation({
    summary: 'Check Unesp role requirement',
    description:
      'Checks if the authenticated user should see Unesp role selection during onboarding.',
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
    description:
      'Returns detailed onboarding status including missing fields for the authenticated user.',
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
    description:
      'Service Unavailable - Unable to connect to authentication service',
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
      throw new HttpException(
        'Unable to verify user onboarding status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({
    summary: 'Get user applications',
    description:
      'Returns a list of applications available to the authenticated user from Keycloak.',
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
        iconUrl:
          app.attributes?.['logo_uri'] || '/app/assets/default-app-icon.svg',
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
      throw new HttpException(
        'Failed to retrieve applications',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @ApiOperation({
    summary: 'Check admin status',
    description:
      'Check if the current user has admin privileges by verifying Keycloak roles',
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
          example: ['Admin', 'discord-admin'],
          description: 'List of admin roles the user has',
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
      const adminRoles = ['Admin', 'discord-admin'];

      const userRoles = await this.keycloakService.getUserRoles(
        session.user!.keycloakId, // Safe to use ! because AuthGuard ensures user exists
      );

      const userAdminRoles = userRoles.filter((role) =>
        adminRoles.includes(role),
      );

      const isAdmin = hasRequiredKeycloakRoles(userRoles, adminRoles);

      this.logger.debug('Admin status check for user', {
        userId: session.user!.keycloakId,
        userRoles,
        adminGroups: userAdminRoles,
        isAdmin,
      });

      return {
        isAdmin,
        adminGroups: userAdminRoles,
      };
    } catch (error) {
      this.logger.error('Error checking admin status', error);
      return {
        isAdmin: false,
        adminGroups: [],
      };
    }
  }
}
