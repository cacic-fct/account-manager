import { Injectable } from '@nestjs/common';
import {
  PrivacyDirective,
  PRIVACY_DIRECTIVE_TYPES,
  DIRECTIVE_VALUES,
  PRIVACY_HEADER_NAME,
} from '../constants/privacy-directives';
import { PrivacyService } from '../privacy.service';
import { Response } from 'express';

@Injectable()
export class PrivacyDirectiveService {
  constructor(private readonly privacyService: PrivacyService) {}

  /**
   * Generate privacy directives for a user
   * Similar to NYT's PURR system - tells frontend what to show/hide
   */
  async generateDirectivesForUser(userId: string): Promise<PrivacyDirective[]> {
    const userSettings = await this.privacyService.getUserSettings(userId);
    const directives: PrivacyDirective[] = [];

    if (!userSettings) {
      // New user - show all consent UI elements
      directives.push(
        {
          type: PRIVACY_DIRECTIVE_TYPES.UI_COOKIE_BANNER,
          value: DIRECTIVE_VALUES.SHOW,
          metadata: { reason: 'new_user', timestamp: new Date() },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.UI_ANALYTICS_CONSENT,
          value: DIRECTIVE_VALUES.SHOW,
          metadata: { reason: 'new_user', timestamp: new Date() },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.UI_ERROR_REPORTING_CONSENT,
          value: DIRECTIVE_VALUES.SHOW,
          metadata: { reason: 'new_user', timestamp: new Date() },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.UI_PERFORMANCE_CONSENT,
          value: DIRECTIVE_VALUES.SHOW,
          metadata: { reason: 'new_user', timestamp: new Date() },
        },
      );

      // Block all data handling until consent is given
      directives.push(
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_ANALYTICS_TRACKING,
          value: DIRECTIVE_VALUES.BLOCK,
          metadata: { reason: 'no_consent', timestamp: new Date() },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_ERROR_DEBUGGING,
          value: DIRECTIVE_VALUES.BLOCK,
          metadata: { reason: 'no_consent', timestamp: new Date() },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_PERFORMANCE_MONITORING,
          value: DIRECTIVE_VALUES.BLOCK,
          metadata: { reason: 'no_consent', timestamp: new Date() },
        },
      );
    } else {
      const settings = userSettings.settings;
      // Existing user - check if cookie banner was accepted
      if (!settings.cookie_banner_accepted) {
        directives.push({
          type: PRIVACY_DIRECTIVE_TYPES.UI_COOKIE_BANNER,
          value: DIRECTIVE_VALUES.SHOW,
          metadata: { reason: 'banner_not_accepted', timestamp: new Date() },
        });
      } else {
        directives.push({
          type: PRIVACY_DIRECTIVE_TYPES.UI_COOKIE_BANNER,
          value: DIRECTIVE_VALUES.HIDE,
          metadata: { reason: 'banner_accepted', timestamp: new Date() },
        });
      }

      // Set data handling directives based on user preferences
      directives.push(
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_ANALYTICS_TRACKING,
          value: settings.analytics_tracking
            ? DIRECTIVE_VALUES.ALLOW
            : DIRECTIVE_VALUES.BLOCK,
          metadata: {
            reason: 'user_preference',
            timestamp: userSettings.updatedAt,
          },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_ERROR_DEBUGGING,
          value: settings.error_debugging
            ? DIRECTIVE_VALUES.ALLOW
            : DIRECTIVE_VALUES.BLOCK,
          metadata: {
            reason: 'user_preference',
            timestamp: userSettings.updatedAt,
          },
        },
        {
          type: PRIVACY_DIRECTIVE_TYPES.DATA_PERFORMANCE_MONITORING,
          value: settings.performance_monitoring
            ? DIRECTIVE_VALUES.ALLOW
            : DIRECTIVE_VALUES.BLOCK,
          metadata: {
            reason: 'user_preference',
            timestamp: userSettings.updatedAt,
          },
        },
      );

      // Hide individual consent UI elements if banner was accepted
      if (settings.cookie_banner_accepted) {
        directives.push(
          {
            type: PRIVACY_DIRECTIVE_TYPES.UI_ANALYTICS_CONSENT,
            value: DIRECTIVE_VALUES.HIDE,
            metadata: { reason: 'banner_accepted', timestamp: new Date() },
          },
          {
            type: PRIVACY_DIRECTIVE_TYPES.UI_ERROR_REPORTING_CONSENT,
            value: DIRECTIVE_VALUES.HIDE,
            metadata: { reason: 'banner_accepted', timestamp: new Date() },
          },
          {
            type: PRIVACY_DIRECTIVE_TYPES.UI_PERFORMANCE_CONSENT,
            value: DIRECTIVE_VALUES.HIDE,
            metadata: { reason: 'banner_accepted', timestamp: new Date() },
          },
        );
      }
    }

    return directives;
  }

  /**
   * Add privacy directives to HTTP response via headers and cookies
   * Efficient PURR-like system - only sends when needed
   */
  async addDirectivesToResponse(
    response: Response,
    userId: string,
  ): Promise<void> {
    const directives = await this.generateDirectivesForUser(userId);

    // Method 1: Response header (JSON) - always include for API clients
    const directivesJson = JSON.stringify(directives);
    response.setHeader(PRIVACY_HEADER_NAME, directivesJson);

    // Method 2: CACIC-PURR Cookie (base64 encoded with expiry)
    await this.setCacicPurrCookie(response, directives, userId);
  }

  /**
   * Set the CACIC-PURR cookie (similar to NYT's nyt-purr cookie)
   * Contains encoded directives with expiry information
   */
  private async setCacicPurrCookie(
    response: Response,
    directives: PrivacyDirective[],
    userId: string,
  ): Promise<void> {
    const userSettings = await this.privacyService.getUserSettings(userId);
    const lastUpdated = userSettings?.updatedAt || new Date();

    // Create compact directive map
    const directivesMap = directives.reduce(
      (acc, directive) => {
        acc[directive.type] = directive.value;
        return acc;
      },
      {} as Record<string, string>,
    );

    // Create cookie payload with expiry and version info
    const cookiePayload = {
      directives: directivesMap,
      userId: userId,
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // 24 hours
      lastUpdated: lastUpdated.toISOString(),
      version: '1.0', // For future compatibility
    };

    // Encode as base64 (like PURR does)
    const encodedPayload = Buffer.from(JSON.stringify(cookiePayload)).toString(
      'base64',
    );

    // Set the cacic-purr cookie
    response.cookie('cacic-purr', encodedPayload, {
      httpOnly: false, // Frontend needs to read this
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
      path: '/', // Available site-wide
    });

    // Also set a simpler cookie for quick JS access (like PURR's approach)
    response.cookie(
      'cacic-purr-quick',
      JSON.stringify({
        cookieBanner:
          directivesMap[PRIVACY_DIRECTIVE_TYPES.UI_COOKIE_BANNER] || 'show',
        analyticsAllowed:
          directivesMap[PRIVACY_DIRECTIVE_TYPES.DATA_ANALYTICS_TRACKING] ===
          'allow',
      }),
      {
        httpOnly: false,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000,
        path: '/',
      },
    );
  }

  /**
   * Check if cached directives are still valid
   * Prevents unnecessary database queries
   */
  async areCachedDirectivesValid(
    cachedDirectives: string,
    userId: string,
  ): Promise<boolean> {
    try {
      const decoded = Buffer.from(cachedDirectives, 'base64').toString('utf-8');
      const data = JSON.parse(decoded) as {
        expires?: string;
        lastUpdated?: string;
        userId?: string;
      };

      // Check expiry
      if (!data.expires || new Date(data.expires) < new Date()) {
        return false;
      }

      // Check if it's for the right user
      if (data.userId !== userId) {
        return false;
      }

      // Check if user settings have been updated since cache
      const userSettings = await this.privacyService.getUserSettings(userId);
      if (
        userSettings &&
        data.lastUpdated &&
        userSettings.updatedAt > new Date(data.lastUpdated)
      ) {
        return false;
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Generate directives as JSON for API responses
   */
  async getDirectivesAsJson(userId: string): Promise<{
    directives: PrivacyDirective[];
    ui: Record<string, string>;
    data: Record<string, string>;
  }> {
    const directives = await this.generateDirectivesForUser(userId);

    // Separate UI and data directives for easier consumption
    const ui: Record<string, string> = {};
    const data: Record<string, string> = {};

    directives.forEach((directive) => {
      if (directive.type.startsWith('ui_')) {
        ui[directive.type] = directive.value;
      } else if (directive.type.startsWith('data_')) {
        data[directive.type] = directive.value;
      }
    });

    return { directives, ui, data };
  }
}
