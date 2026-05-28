/**
 * Angular entry point for the cookie banner library.
 *
 * Usage:
 * ```typescript
 * import { CookieBannerComponent } from '@cacic/cookie-banner/angular';
 * ```
 *
 * This entry point exports the Angular wrapper component.
 * For the vanilla JS implementation, import from '@cacic/cookie-banner'.
 */

export { CookieBannerComponent } from './cookie-banner.component';

export type {
  CookieBannerOptions,
  CookieBannerAcceptContext,
} from '../lib/cookie-banner';
