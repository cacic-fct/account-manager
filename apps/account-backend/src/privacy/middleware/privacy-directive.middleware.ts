import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrivacyDirectiveService } from '../services/privacy-directive.service';
import { AuthSession } from '../../auth/auth.controller';
import { CACIC_PURR_COOKIE_NAME } from '../constants/privacy-directives';
import type { PrivacyUserIdentity } from '../privacy.service';

@Injectable()
export class PrivacyDirectiveMiddleware implements NestMiddleware {
  constructor(
    private readonly privacyDirectiveService: PrivacyDirectiveService,
  ) {}

  private readonly logger = new Logger(PrivacyDirectiveMiddleware.name);

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    try {
      const session = req.session as unknown as AuthSession;

      // Only send directives on specific conditions (PURR-style efficiency)
      if (session?.user?.keycloakId) {
        await this.handlePrivacyDirectives(req, res, {
          userId: session.user.keycloakId,
        });
      }
    } catch (error) {
      this.logger.error('Failed to handle privacy directives', error);
    } finally {
      next();
    }
  }

  /**
   * Handle privacy directives with intelligent caching (PURR-style)
   */
  private async handlePrivacyDirectives(
    req: Request,
    res: Response,
    identity: PrivacyUserIdentity,
  ): Promise<void> {
    const shouldSend = await this.shouldSendDirectives(req, identity);

    if (shouldSend) {
      await this.privacyDirectiveService.addDirectivesToResponse(res, identity);
    }
  }

  private async shouldSendDirectives(
    req: Request,
    identity: PrivacyUserIdentity,
  ): Promise<boolean> {
    // Send directives only when needed (like PURR):

    // 1. On page loads (HTML requests)
    const isPageLoad = req.headers.accept?.includes('text/html');

    // 2. On privacy-related API calls
    const isPrivacyEndpoint = req.path.includes('/privacy');

    // 3. When cookie banner endpoint is called
    const isCookieBannerEndpoint = req.path.includes('/cookie-banner');

    // 4. When directives are explicitly requested
    const isDirectiveRequest = req.path.includes('/directives');

    // 5. When privacy settings have been updated (check for specific header)
    const hasPrivacyUpdateHeader = req.headers['x-privacy-updated'] === 'true';

    // 6. Check CACIC-PURR cookie validity
    const cookies = req.cookies as
      | Record<string, string | undefined>
      | undefined;
    const cacicPurrCookie = cookies?.[CACIC_PURR_COOKIE_NAME];
    let hasMissingOrExpiredCookie = true;

    if (cacicPurrCookie) {
      // Use service to validate cache
      const isValid =
        await this.privacyDirectiveService.areCachedDirectivesValid(
          cacicPurrCookie,
          identity,
        );
      hasMissingOrExpiredCookie = !isValid;
    }

    return (
      isPageLoad ||
      isPrivacyEndpoint ||
      isCookieBannerEndpoint ||
      isDirectiveRequest ||
      hasPrivacyUpdateHeader ||
      hasMissingOrExpiredCookie
    );
  }
}
