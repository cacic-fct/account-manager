# @cacic-fct/account-manager-m2m-contracts

Framework-agnostic contracts for CACiC Account Manager machine-to-machine APIs.

The package exports the canonical gRPC contract, privacy setting keys, M2M role names,
request/response types, privacy directive constants, PURR-style header
and cookie names, and shared CACiC analytics tracking cookie names used by
Account Manager.

## Install

Install from the public npm registry with Bun:

```bash
bun add @cacic-fct/account-manager-m2m-contracts
```

## Use

New machine-to-machine integrations should load
`proto/cacic/m2m/account_manager/v1.proto`, use the `AccountManagerM2M` service,
and send a Keycloak service-account bearer token in gRPC metadata.

Browser-facing privacy and analytics integrations remain REST-based through
`CACIC_TRACKING_ROUTES` and the authenticated `/api/privacy/*` endpoints; they
are separate from the privileged M2M transport.

```ts
import {
  M2M_PRIVACY_ROLES,
  M2M_USER_ROLES,
  CACIC_TRACKING_ROUTES,
  PRIVACY_SETTING_TYPES,
} from '@cacic-fct/account-manager-m2m-contracts';

const trackingRefreshUrl = CACIC_TRACKING_ROUTES.session;
const privacyReadRole = M2M_PRIVACY_ROLES.READ;
const userLookupRole = M2M_USER_ROLES.READ;
const analyticsSetting = PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING;
```

## Building

Run `bunx nx build m2m-contracts` to build the library.

The built package also includes the canonical
`proto/cacic/m2m/account_manager/v1.proto` gRPC contract. Runtime services should use
that contract over an internal, scoped network and continue sending Keycloak
service-account tokens in gRPC metadata.

## Publishing

This package has an independent release cycle. Bump this package's own
`version` before merging changes that should be published.

Run `bun run publish:m2m-contracts` from the repository root when publishing
manually. The CI workflow publishes this package to npm through Trusted
Publishing.
