import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import {
  CookieBanner,
  type CookieBannerOptions,
  createCookieBanner,
} from '../lib/cookie-banner';

/**
 * Angular wrapper component for the vanilla JS CookieBanner.
 * This component can be used by Angular applications to display the cookie banner.
 *
 * Usage:
 * ```typescript
 * <lib-cookie-banner [config]="cookieBannerConfig" />
 * ```
 *
 * The config object accepts all CookieBannerOptions.
 */
@Component({
  selector: 'lib-cookie-banner',
  template: '',
  standalone: true,
})
export class CookieBannerComponent implements OnInit, OnDestroy {
  @Input({ required: true }) config!: CookieBannerOptions;
  private cookieBanner: CookieBanner | null = null;

  ngOnInit(): void {
    this.cookieBanner = createCookieBanner(this.config);
  }

  ngOnDestroy(): void {
    this.cookieBanner?.destroy();
  }
}
