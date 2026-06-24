# @cacic-fct/account-manager-m2m-contracts

Framework-agnostic contracts for CACiC Account Manager machine-to-machine APIs.

The package exports the privacy setting keys, M2M role names, endpoint helpers,
request/response DTO types, privacy directive constants, PURR-style header
and cookie names, and shared CACiC analytics tracking cookie names used by
Account Manager.

## Install

Install from the public npm registry with Bun:

```bash
bun add @cacic-fct/account-manager-m2m-contracts
```

## Use

```ts
import {
  M2M_PRIVACY_ROLES,
  M2M_PRIVACY_ROUTES,
  CACIC_TRACKING_ROUTES,
  PRIVACY_SETTING_TYPES,
  type M2MBulkPrivacySettingsRequest,
  type M2MPrivacySettingResponse,
} from '@cacic-fct/account-manager-m2m-contracts';

const body: M2MBulkPrivacySettingsRequest = {
  settings: [
    {
      settingType: PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING,
      enabled: false,
    },
  ],
};

const trackingRefreshUrl = CACIC_TRACKING_ROUTES.session;
```

## Building

Run `bunx nx build m2m-contracts` to build the library.

## Publishing

This package has an independent release cycle. Bump this package's own
`version` before merging changes that should be published.

Run `bun run publish:m2m-contracts` from the repository root when publishing
manually. The CI workflow publishes this package to npm through Trusted
Publishing.
