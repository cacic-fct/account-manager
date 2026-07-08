# @cacic-fct/account-manager-privacy

Angular client for reading CACiC account privacy preferences from the account API.

## Install

Install from the public npm registry with Bun:

```bash
bun add @cacic-fct/account-manager-privacy
```

## Use

```ts
import { CacicAccountPrivacyService, provideCacicAccountPrivacy } from '@cacic-fct/account-manager-privacy';
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

Use `refreshTrackingCookies()` after login/session refresh to ask Account Manager to refresh the shared CACiC analytics cookies. Use `clearTrackingCookies()` during logout flows in sibling applications before redirecting away.

## Umami tracking helper

Static sites can use the browser helper to respect Account Manager privacy settings before loading Umami:

```ts
import { initCacicUmamiTracking } from '@cacic-fct/account-manager-privacy/umami-tracking';

await initCacicUmamiTracking({
  websiteId: 'your-umami-website-id',
  domains: ['cacic.dev.br'],
});
```

The helper refreshes `/api/tracking/session`, reads the shared CACiC cookies, loads Umami when Account Manager has `analytics_tracking` enabled, and calls `umami.identify()` with the `cacic-analytics-id` cookie as Umami's Distinct ID. Anonymous visitors are tracked without `identify()` unless a consent cookie explicitly disables analytics. Cookie banner acceptance is reported separately in the identify payload. It does not send email, name, or profile fields unless the caller explicitly passes `identifyData`.

Sites that configure analytics through a production-only script tag can use the current-script bootstrap:

```ts
import { startCacicUmamiTrackingFromCurrentScript } from '@cacic-fct/account-manager-privacy/umami-tracking';

startCacicUmamiTrackingFromCurrentScript({
  identifyData: {
    source: window.location.hostname,
  },
});
```

## Publishing

This package has an independent release cycle. Updates under `libs/account-privacy` trigger the package publishing workflow, so bump this package's own `version` before merging changes that should be published.
The CI workflow publishes this package to npm through Trusted Publishing.
