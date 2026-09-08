# M2M Authentication For Account Manager gRPC

The M2M gRPC service uses OAuth 2.0 client credentials with Keycloak service-account tokens. Callers authenticate with Keycloak, receive a JWT access token, and send it as `authorization: Bearer <token>` gRPC metadata. Production connections also require mutual TLS.

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
   - `totp:validate`
   - `totp:relay`
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

Use `@cacic-fct/account-manager-m2m-contracts` in callers for the canonical protobuf contract, role names, setting keys, and shared types.

```bash
bun add @cacic-fct/account-manager-m2m-contracts
```

```ts
import {
  M2M_PRIVACY_ROLES,
  M2M_USER_ROLES,
  PRIVACY_SETTING_TYPES,
} from '@cacic-fct/account-manager-m2m-contracts';

const requiredRole = M2M_PRIVACY_ROLES.WRITE;
const usersRequiredRole = M2M_USER_ROLES.READ;
const analyticsSetting = PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING;
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

## gRPC Calls

```bash
grpcurl \
  -import-path ./node_modules/@cacic-fct/account-manager-m2m-contracts/proto \
  -proto cacic/m2m/account_manager/v1.proto \
  -cacert /run/secrets/cacic-grpc-ca.pem \
  -cert /run/secrets/caller-grpc-cert.pem \
  -key /run/secrets/caller-grpc-key.pem \
  -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"userId":"USER_ID"}' \
  account-manager:50051 \
  cacic.m2m.account_manager.v1.AccountManagerM2M/GetPrivacySettings
```

```bash
grpcurl \
  -import-path ./node_modules/@cacic-fct/account-manager-m2m-contracts/proto \
  -proto cacic/m2m/account_manager/v1.proto \
  -cacert /run/secrets/cacic-grpc-ca.pem \
  -cert /run/secrets/caller-grpc-cert.pem \
  -key /run/secrets/caller-grpc-key.pem \
  -H "authorization: Bearer YOUR_ACCESS_TOKEN" \
  -d '{"enrollmentNumbers":["24123456"]}' \
  account-manager:50051 \
  cacic.m2m.account_manager.v1.AccountManagerM2M/LookupUsersByEnrollment
```

## RPCs

- `GetPrivacySettings` requires `privacy:read`.
- `RecordCookieConsent` requires `privacy:write`.
- `LookupUsersByEnrollment` and `LookupUsersByIdentifier` require `users:read`.
- `ValidateTotp` requires `totp:validate`.
- `EnsureTotpSeed` requires `totp:relay`.

## Common Failures

- `401 Unauthorized`: token is missing, invalid, expired, has the wrong issuer, or does not include `KEYCLOAK_M2M_AUDIENCE` in `aud`.
- `403 Forbidden`: token is valid, but caller is not in `KEYCLOAK_M2M_ALLOWED_CLIENTS`, is not a service-account token, or lacks the required role under `resource_access[KEYCLOAK_M2M_AUDIENCE].roles`.
