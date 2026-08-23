import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { CookieBannerComponent, CookieBannerOptions } from '@cacic-fct/account-manager-cookie-banner/angular';
import { hasAcceptedCookieBanner } from '@cacic-fct/account-manager-cookie-banner';
import { MatIconRegistry } from '@angular/material/icon';
import { PrivacyDirectiveService } from './shared/services/privacy-directive.service';
import { AuthService } from './shared/services/auth/auth.service';
import { LoggerService } from './shared/services/logger.service';
import type { PrivacyDirectives } from './shared/interfaces/privacy-directive.interface';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, CookieBannerComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
})
export class AppComponent {
  title = 'cacic-account-manager';

  iconRegistry = inject(MatIconRegistry);
  private privacyDirectiveService = inject(PrivacyDirectiveService);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);

  logoutError = this.authService.logoutError;

  cookieBannerConfig: CookieBannerOptions;

  constructor() {
    this.iconRegistry.setDefaultFontSetClass('material-icons');

    // Fetch privacy directives
    this.privacyDirectiveService.fetchDirectives().subscribe({
      next: (directives) => {
        this.syncAuthenticatedCookieBannerAcceptance(directives);
      },
      error: (error) => {
        this.logger.warn('Failed to fetch privacy directives', error, { operation: 'privacy-directives' });
      },
    });

    // Configure cookie banner
    this.cookieBannerConfig = {
      privacyPolicyUrl: 'https://cacic.com.br/legal/privacy-policy',
      isAuthenticated: () => this.authService.isAuthenticated(),
      shouldShow: async () => {
        const directives = this.privacyDirectiveService.directives();
        if (
          directives?.cookieBanner.action === 'hide' ||
          this.privacyDirectiveService.shouldShowCookieBanner() === false
        ) {
          return false;
        }
        return true;
      },
      onAccept: async (context) => {
        if (context.isAuthenticated) {
          return new Promise((resolve) => {
            this.privacyDirectiveService.acceptCookieBanner().subscribe({
              next: (success) => {
                if (!success) {
                  this.logger.warn('Cookie banner acceptance was not confirmed', { operation: 'cookie-banner' });
                }
                resolve(!success ? false : undefined);
              },
              error: (error) => {
                this.logger.error('Error accepting cookie banner', error, { operation: 'cookie-banner' });
                resolve(false);
              },
            });
          });
        }
      },
    };
  }

  private syncAuthenticatedCookieBannerAcceptance(directives: PrivacyDirectives): void {
    if (
      !this.authService.isAuthenticated() ||
      !hasAcceptedCookieBanner() ||
      directives.cookieBanner.action !== 'show'
    ) {
      return;
    }

    this.privacyDirectiveService.acceptCookieBanner().subscribe({
      error: (error) => {
        this.logger.warn('Failed to sync cookie banner acceptance', error, { operation: 'cookie-banner' });
      },
    });
  }
}
