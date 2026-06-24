# @cacic-fct/account-manager-cookie-banner

CACiC cookie consent banner with vanilla JavaScript and Angular entry points.

## Install

Install from the public npm registry with Bun:

```bash
bun add @cacic-fct/account-manager-cookie-banner
```

## Angular

```ts
import {
  CookieBannerComponent,
  type CookieBannerOptions,
} from '@cacic-fct/account-manager-cookie-banner/angular';
```

```html
<lib-cookie-banner [config]="cookieBannerConfig" />
```

When a user accepts the banner on `cacic.dev.br` or any `*.cacic.dev.br`
subdomain, the package stores a shared `cacic_cookie_banner_accepted=true`
cookie for `.cacic.dev.br`. Other CACiC sites on the same domain will hide the
banner even for logged-out users. The package also keeps the existing
`localStorage` marker as a fallback for localhost and non-shared domains.

## Vanilla

```ts
import {
  createCookieBanner,
  hasAcceptedCookieBanner,
} from '@cacic-fct/account-manager-cookie-banner';

createCookieBanner({
  privacyPolicyUrl: 'https://cacic.dev.br/legal/privacy-policy',
});

console.log(hasAcceptedCookieBanner());
```

## Building

Run `bunx nx build cookie-banner` to build the library.

## Publishing

This package has an independent release cycle. Updates under `libs/cookie-banner` trigger the package publishing workflow, so bump this package's own `version` before merging changes that should be published.

Run `bun run publish:cookie-banner` from the repository root when publishing
manually. The CI workflow publishes this package to npm through Trusted
Publishing.
