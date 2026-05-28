# Keycloak M2M Setup

Account Manager uses Keycloak service-account JWTs for both inbound and outbound machine-to-machine communication. Do not configure static API tokens.

Use the same shape for every backend:

- One confidential service-account client for the caller, for example `cacic-account-manager-m2m`.
- One API/resource audience for the receiver, for example `cacic-account-manager-api`.
- Client roles on the API/resource client when possible. Realm roles are still accepted for compatibility.
- A Keycloak audience mapper so access tokens include the receiver audience in `aud`.

## Inbound Calls To Account Manager

External backends call Account Manager with `Authorization: Bearer <access_token>`.

1. In Keycloak, create one confidential client per external backend.
2. Enable **Client authentication**.
3. Enable **Service accounts roles**.
4. Add roles for the permissions the backend needs. Prefer client roles on `cacic-account-manager-api`:
   - `privacy:read`
   - `privacy:write`
5. Add an audience mapper so access tokens include the Account Manager API audience.
6. Set Account Manager environment:

```env
KEYCLOAK_URL=https://sso.cacic.dev.br
KEYCLOAK_REALM=cacic-sso
KEYCLOAK_M2M_AUDIENCE=cacic-account-manager-api
KEYCLOAK_M2M_ALLOWED_CLIENTS=cacic-event-manager-m2m
KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT=true
JWT_CLOCK_SKEW_TOLERANCE=30
```

`KEYCLOAK_M2M_ALLOWED_CLIENTS` is optional, but production should set it.

## Outbound Calls From Account Manager

Account Manager obtains its own client-credentials token from Keycloak before calling external merge backends.

1. Create a confidential client for Account Manager M2M, for example `cacic-account-manager-m2m`.
2. Enable **Client authentication** and **Service accounts roles**.
3. Assign roles the external services expect, usually on their API/resource client:
   - `account-profile:write`
   - `account-merge:score`
   - `account-merge:write`
   - `lgpd:read`
   - `lgpd:delete`
4. Configure Account Manager:

```env
KEYCLOAK_M2M_CLIENT_ID=cacic-account-manager-m2m
KEYCLOAK_M2M_CLIENT_SECRET=<client-secret>
```

5. Configure merge backends:

```json
ACCOUNT_MERGE_EXTERNAL_BACKENDS=[
  {
    "name": "external-app-a",
    "scoreUrl": "https://external-a.cacic.dev.br/account-merge/score",
    "mergeUrl": "https://external-a.cacic.dev.br/account-merge/merge",
    "audience": "external-app-a-api"
  }
]
```

The `audience` field is a target identifier for the token request/cache. Do not rely on the request parameter alone. The required production piece is that Keycloak mappers or client-role audience resolution make the resulting token contain the receiver audience expected by that backend.

## Token Expectations

Account Manager validates:

- Signature against Keycloak JWKS.
- Issuer equals `KEYCLOAK_URL/realms/KEYCLOAK_REALM`.
- Audience includes `KEYCLOAK_M2M_AUDIENCE`.
- Token is a service-account token by default.
- Client is in `KEYCLOAK_M2M_ALLOWED_CLIENTS` when configured.
- Endpoint roles declared with `@RequireRoles(...)`, from realm roles or client roles.

External services should apply the same checks for tokens received from Account Manager.
