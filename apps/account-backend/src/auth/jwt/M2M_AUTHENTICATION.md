# M2M Authentication For Account Manager APIs

The M2M APIs use OAuth 2.0 client credentials with Keycloak service-account tokens. Callers authenticate with Keycloak, receive a JWT access token, and call Account Manager with `Authorization: Bearer <token>`.

## Token Requirements

Account Manager accepts an M2M token only when all of these are true:

- The signature validates against Keycloak JWKS.
- `iss` is `KEYCLOAK_URL/realms/KEYCLOAK_REALM`.
- `aud` includes `KEYCLOAK_M2M_AUDIENCE`.
- `azp` or `client_id` is listed in `KEYCLOAK_M2M_ALLOWED_CLIENTS`.
- The token is a service-account token when `KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT` is not `false`.
- Required endpoint roles are present under `resource_access[KEYCLOAK_M2M_AUDIENCE].roles`.

Realm roles and roles under unrelated clients do not authorize Account Manager M2M endpoints.

## Keycloak Setup Shape

Use two Keycloak objects for the receiving API:

- A client named like the receiver audience, for example `cacic-account-manager-audience`.
- A client scope with an audience mapper that adds that client ID to access-token `aud`.

For an Event Manager caller:

1. Create or open client `cacic-account-manager-audience`.
2. On its **Roles** tab, create:
   - `privacy:read`
   - `privacy:write`
   - `users:read`
3. Create or open confidential clients for each caller, for example `cacic-event-manager-m2m` and `cacic-voto-m2m`.
4. Enable **Client authentication** and **Service accounts roles**.
5. On each caller **Service account roles**, assign only the required roles from `cacic-account-manager-audience`.
6. Create or open client scope `cacic-account-manager-audience`.
7. Add an **Audience** mapper:
   - Included Client Audience: `cacic-account-manager-audience`
   - Add to access token: on
8. Attach that client scope to each caller as a **Default** client scope.

## Account Manager Environment

```env
KEYCLOAK_URL=https://sso.cacic.com.br
KEYCLOAK_REALM=cacic-sso
KEYCLOAK_M2M_AUDIENCE=cacic-account-manager-audience
KEYCLOAK_M2M_ALLOWED_CLIENTS=cacic-event-manager-m2m,cacic-voto-m2m
KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT=true
JWT_CLOCK_SKEW_TOLERANCE=30
```

`KEYCLOAK_M2M_AUDIENCE` and `KEYCLOAK_M2M_ALLOWED_CLIENTS` are required.

## Contracts Package

Use `@cacic-fct/account-manager-m2m-contracts` in TypeScript callers to share endpoint helpers, role names, setting keys, directive constants, and request/response types with Account Manager.

```bash
bun add @cacic-fct/account-manager-m2m-contracts
```

```ts
import {
  M2M_PRIVACY_ROLES,
  M2M_USER_ROLES,
  M2M_PRIVACY_ROUTES,
  M2M_USER_ROUTES,
  PRIVACY_SETTING_TYPES,
  type M2MBulkPrivacySettingsRequest,
  type M2MUserEnrollmentLookupRequest,
} from '@cacic-fct/account-manager-m2m-contracts';

const requiredRole = M2M_PRIVACY_ROLES.WRITE;
const route = M2M_PRIVACY_ROUTES.bulkSettings('keycloak-user-id');
const body: M2MBulkPrivacySettingsRequest = {
  settings: [
    {
      settingType: PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING,
      enabled: false,
    },
  ],
};

const usersRequiredRole = M2M_USER_ROLES.READ;
const usersRoute = M2M_USER_ROUTES.enrollmentLookup();
const usersBody: M2MUserEnrollmentLookupRequest = {
  enrollmentNumbers: ['24123456'],
};
```

## Requesting A Token

```bash
curl -X POST "https://sso.cacic.com.br/realms/cacic-sso/protocol/openid-connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=cacic-event-manager-m2m" \
  -d "client_secret=<client-secret>"
```

Decode the returned access token before wiring the API call. It must contain:

```json
{
  "aud": ["cacic-account-manager-audience"],
  "azp": "cacic-event-manager-m2m",
  "preferred_username": "service-account-cacic-event-manager-m2m",
  "resource_access": {
    "cacic-account-manager-audience": {
      "roles": ["privacy:write"]
    }
  }
}
```

## API Calls

```bash
curl -X POST "https://account.cacic.com.br/api/v1/privacy/user/USER_ID/cookie-consent" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

```bash
curl -X POST "https://account.cacic.com.br/api/v1/privacy/user/USER_ID/settings/bulk" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": [
      {
        "settingType": "analytics_tracking",
        "enabled": false
      }
    ]
  }'
```

## Endpoints

- `GET /api/v1/privacy/user/:userId/settings` requires `privacy:read`.
- `GET /api/v1/privacy/user/:userId/setting/:settingType` requires `privacy:read`.
- `GET /api/v1/privacy/user/:userId/cookie-consent` requires `privacy:read`.
- `POST /api/v1/privacy/user/:userId/cookie-consent` requires `privacy:write`.
- `POST /api/v1/privacy/user/:userId/settings/bulk` requires `privacy:write`.
- `POST /api/v1/users/enrollment-lookup` requires `users:read`.
- `POST /api/v1/users/identifier-lookup` requires `users:read`.

## Common Failures

- `401 Unauthorized`: token is missing, invalid, expired, has the wrong issuer, or does not include `KEYCLOAK_M2M_AUDIENCE` in `aud`.
- `403 Forbidden`: token is valid, but caller is not in `KEYCLOAK_M2M_ALLOWED_CLIENTS`, is not a service-account token, or lacks the required role under `resource_access[KEYCLOAK_M2M_AUDIENCE].roles`.
