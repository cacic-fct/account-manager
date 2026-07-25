# Keycloak M2M Setup

Account Manager uses Keycloak service-account JWTs for inbound and outbound machine-to-machine communication. Do not configure static API tokens.

Use the same shape for every backend:

- One confidential service-account client for the caller, for example `cacic-account-manager-m2m`.
- One API/resource audience client for the receiver, for example `cacic-account-manager-audience`.
- Client roles on the receiver API/resource audience client.
- A Keycloak audience mapper, normally through a default client scope on the caller, so access tokens include the receiver audience in `aud`.

## Inbound Calls To Account Manager

External backends call Account Manager with `Authorization: Bearer <access_token>`.

1. In Keycloak, create one confidential service-account client per external backend, for example `cacic-event-manager-m2m`.
2. Create or reuse the Account Manager API/resource audience client, for example `cacic-account-manager-audience`.
3. On `cacic-account-manager-audience`, create the client roles Account Manager endpoints require:
   - `privacy:read`
   - `privacy:write`
   - `users:read`
4. On the caller service account, assign only the needed roles from `cacic-account-manager-audience`.
5. Add an audience mapper so caller access tokens include `cacic-account-manager-audience` in `aud`.
6. Set Account Manager environment:

```env
KEYCLOAK_URL=https://sso.example.org
KEYCLOAK_REALM=cacic-sso
KEYCLOAK_M2M_AUDIENCE=cacic-account-manager-audience
KEYCLOAK_M2M_ALLOWED_CLIENTS=cacic-event-manager-m2m,cacic-voto-m2m
KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT=true
JWT_CLOCK_SKEW_TOLERANCE=30
```

`KEYCLOAK_M2M_AUDIENCE` and `KEYCLOAK_M2M_ALLOWED_CLIENTS` are required. Account Manager fails closed when either value is missing.

## Outbound Calls From Account Manager

Account Manager obtains its own client-credentials token from Keycloak before calling other backends.

1. Create a confidential client for Account Manager M2M, for example `cacic-account-manager-m2m`.
2. Enable **Client authentication** and **Service accounts roles**.
3. Assign roles the external services expect on their API/resource audience client. For Event Manager this is usually `cacic-event-manager-audience` with:
   - `account-profile:write`
   - `account-merge:score`
   - `account-merge:write`
   - `lgpd:read`
   - `lgpd:delete`
4. Add an audience mapper so Account Manager access tokens include the target audience, for example `cacic-event-manager-audience`.
5. Configure Account Manager:

```env
KEYCLOAK_M2M_CLIENT_ID=cacic-account-manager-m2m
KEYCLOAK_M2M_CLIENT_SECRET=<client-secret>
EVENT_MANAGER_M2M_AUDIENCE=cacic-event-manager-audience
```

6. Configure merge backends:

```json
ACCOUNT_MERGE_GRPC_BACKENDS=[
  {
    "name": "event-manager",
    "target": "events-backend:50051",
    "audience": "cacic-event-manager-audience"
  }
]
```

7. Configure LGPD backends when needed:

```json
LGPD_GRPC_BACKENDS=[
  {
    "name": "event-manager",
    "category": "event_manager",
    "target": "events-backend:50051",
    "audience": "cacic-event-manager-audience"
  }
]
LGPD_DELETION_GRPC_BACKENDS=[
  {
    "name": "event-manager",
    "target": "events-backend:50051",
    "actions": ["schedule", "delete"],
    "audience": "cacic-event-manager-audience"
  }
]
```

The `audience` field is a target identifier for the token request/cache. The required production piece is that Keycloak mappers make the resulting token contain the receiver audience expected by that backend.

## Token Expectations

Account Manager validates:

- Signature against Keycloak JWKS.
- Issuer equals `KEYCLOAK_URL/realms/KEYCLOAK_REALM`.
- Audience includes `KEYCLOAK_M2M_AUDIENCE`.
- Token is a service-account token by default.
- Client is listed in `KEYCLOAK_M2M_ALLOWED_CLIENTS`.
- Endpoint roles declared with `@RequireRoles(...)` are present under `resource_access[KEYCLOAK_M2M_AUDIENCE].roles`.

External services should apply the same checks for tokens received from Account Manager.
