# Keycloak development realm

Start the local Keycloak instance from this repository:

```bash
docker compose -f docker/docker-compose.keycloak.yml up
```

Keycloak listens on `http://localhost:8080`. The admin console credentials are
`admin` / `admin`.

The `cacic-sso` realm is imported from `docker/keycloak/cacic-sso-realm.json`.
If you change the realm file and Keycloak keeps old data, recreate the
container before starting it again.

## Development users

All users use the password `1`.

| Email | Purpose |
| --- | --- |
| `super-admin@unesp.br` | Super admin in Account Manager and Event Manager. |
| `aluno@unesp.br` | Verified Unesp student, CACiC student entity member, regular app access. |
| `professor@unesp.br` | Verified Unesp professor with Event Manager access only. |
| `externo@gmail.com` | External user with incomplete onboarding and no app roles. |

## Static development clients

| Client | Secret |
| --- | --- |
| `cacic-account-manager` | `cacic-account-manager-dev-secret` |
| `cacic-event-manager` | `cacic-event-manager-dev-secret` |
| `cacic-account-manager-admin-client` | `cacic-account-manager-admin-client-dev-secret` |
| `cacic-account-manager-m2m` | `cacic-account-manager-m2m-dev-secret` |
| `cacic-event-manager-m2m` | `cacic-event-manager-m2m-dev-secret` |

The backends use these values as development fallbacks when the matching
environment variables are not set. In production, set real secrets; the
password-login endpoint and local password forms are disabled regardless of
`KEYCLOAK_PASSWORD_LOGIN_ENABLED`.

To force Google login in a local production-like test, set:

```bash
KEYCLOAK_LOGIN_IDP_HINT=google
```
