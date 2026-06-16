# @cacic-fct/account-manager-cookie-banner

CACiC cookie consent banner with vanilla JavaScript and Angular entry points.

## Install

Configure GitHub Packages for the CACiC FCT scope:

```ini
@cacic-fct:registry=https://npm.pkg.github.com
```

Then install with Bun:

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

## Vanilla

```ts
import { createCookieBanner } from '@cacic-fct/account-manager-cookie-banner';

createCookieBanner({
  privacyPolicyUrl: 'https://cacic.dev.br/legal/privacy-policy',
});
```

## Building

Run `bunx nx build cookie-banner` to build the library.

## Publishing

This package has an independent release cycle. Updates under `libs/cookie-banner` trigger the package publishing workflow, so bump this package's own `version` before merging changes that should be published.

Run `bun run publish:cookie-banner` from the repository root when publishing manually.
