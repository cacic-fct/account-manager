# @cacic-fct/account-manager-privacy

Angular client for reading CACiC account privacy preferences from the account API.

## Install

Configure GitHub Packages for the CACiC FCT scope:

```ini
@cacic-fct:registry=https://npm.pkg.github.com
```

Then install with Bun:

```bash
bun add @cacic-fct/account-manager-privacy
```

## Use

```ts
import {
  CacicAccountPrivacyService,
  provideCacicAccountPrivacy,
} from '@cacic-fct/account-manager-privacy';
```

Add the provider to the application config when the account API base URL differs from the default:

```ts
providers: [
  provideCacicAccountPrivacy({
    apiBaseUrl: 'https://account.cacic.dev.br/api',
  }),
];
```

Inject `CacicAccountPrivacyService` to read signals such as `analyticsEnabled`, `errorDebuggingEnabled`, `performanceMonitoringEnabled`, and `cookieBannerAccepted`.

## Publishing

This package has an independent release cycle. Updates under `libs/account-privacy` trigger the package publishing workflow, so bump this package's own `version` before merging changes that should be published.
