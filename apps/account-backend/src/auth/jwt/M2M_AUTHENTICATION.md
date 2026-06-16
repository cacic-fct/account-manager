# M2M (Machine-to-Machine) Authentication for Privacy API

This document explains how to set up and use Machine-to-Machine authentication for accessing the Account Manager privacy settings via external services.

## Overview

The privacy API uses OAuth 2.0 Machine-to-Machine (M2M) authentication with Keycloak. External services authenticate with Keycloak to get a JWT token, then use that token to access the Account Manager privacy endpoints.

## Architecture

```
External Service → Keycloak (M2M Auth) → JWT Token → Account Manager API
```

1. External service authenticates with Keycloak using client credentials
2. Keycloak returns a JWT access token
3. External service calls Account Manager API with JWT in Authorization header
4. Account Manager validates JWT against Keycloak's JWKS endpoint
5. If valid, API returns privacy settings

## Keycloak Setup

### 1. Create a Client for M2M Authentication

1. Log into Keycloak Admin Console
2. Navigate to your realm
3. Go to **Clients** → **Create client**
4. Configure the client:
   - **Client ID**: `privacy-api-client` (or your preferred name)
   - **Client authentication**: ON
   - **Authorization**: OFF
   - **Authentication flow**: Only check "Service accounts roles"

### 2. Configure Client Roles

1. Go to **Realm roles** → **Create client role**
2. Create the following roles:
   - `privacy:read` - For reading privacy settings
   - `privacy:write` - For updating privacy settings

3. Assign roles to your client:
   - Go to **Clients** → Your client → **Realm roles**
   - Add the privacy roles to **Assigned Default Client Roles**

### 3. Get Client Credentials

1. Go to **Clients** → Your client → **Credentials**
2. Copy the **Client secret**
3. Note your **Client ID**

## Environment Configuration

Add these environment variables to your Account Manager backend `.env`:

```env
# Keycloak Configuration for M2M Authentication
KEYCLOAK_URL=https://sso.cacic.dev.br
KEYCLOAK_REALM=cacic-sso

# M2M JWT Security Configuration
# Expected audience for M2M tokens (defaults to 'account')
KEYCLOAK_M2M_AUDIENCE=account

# JWT clock skew tolerance in seconds (defaults to 30)
# Allows tokens to be valid within this time window for clock differences
JWT_CLOCK_SKEW_TOLERANCE=30
```

## Using the API

### Contracts package

Use `@cacic-fct/m2m-contracts` in TypeScript callers to share endpoint
helpers, role names, setting keys, directive constants, and request/response
types with Account Manager.

```bash
bun add @cacic-fct/m2m-contracts
```

```ts
import {
  M2M_PRIVACY_ROLES,
  M2M_PRIVACY_ROUTES,
  PRIVACY_SETTING_TYPES,
  type M2MBulkPrivacySettingsRequest,
} from '@cacic-fct/m2m-contracts';

const body: M2MBulkPrivacySettingsRequest = {
  settings: [
    {
      settingType: PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING,
      enabled: false,
    },
  ],
};
```

### 1. Get Access Token from Keycloak

```bash
curl -X POST "https://sso.cacic.dev.br/realms/cacic-sso/protocol/openid_connect/token" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=client_credentials" \
  -d "client_id=privacy-api-client" \
  -d "client_secret=your-client-secret" \
  -d "role=privacy:read privacy:write"
```

Response:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_in": 300,
  "token_type": "Bearer",
  "role": "privacy:read privacy:write"
}
```

### 2. Call Account Manager Privacy API

Use the access token to call the privacy endpoints:

```bash
# Get all privacy settings for a user
curl -X GET "https://account.cacic.dev.br/api/v1/privacy/user/USER_ID/settings" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Get specific privacy setting
curl -X GET "https://account.cacic.dev.br/api/v1/privacy/user/USER_ID/setting/analytics_tracking" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Check cookie consent
curl -X GET "https://account.cacic.dev.br/api/v1/privacy/user/USER_ID/cookie-consent" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Record cookie consent
curl -X POST "https://account.cacic.dev.br/api/v1/privacy/user/USER_ID/cookie-consent" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"

# Bulk update settings
curl -X POST "https://account.cacic.dev.br/api/v1/privacy/user/USER_ID/settings/bulk" \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "settings": [
      {
        "settingType": "analytics_tracking",
        "enabled": false
      },
      {
        "settingType": "debug_tracking",
        "enabled": true
      }
    ]
  }'
```

## API Endpoints

### GET /api/v1/privacy/user/:userId/settings

- **Role**: `privacy:read`
- **Description**: Get all privacy settings for a user
- **Response**: Array of privacy settings

### GET /api/v1/privacy/user/:userId/setting/:settingType

- **Role**: `privacy:read`
- **Description**: Get specific privacy setting
- **Response**: Single privacy setting

### GET /api/v1/privacy/user/:userId/cookie-consent

- **Role**: `privacy:read`
- **Description**: Check cookie consent status
- **Response**: `{ hasConsent: boolean, consentDate: Date | null }`

### POST /api/v1/privacy/user/:userId/cookie-consent

- **Role**: `privacy:write`
- **Description**: Record cookie consent
- **Response**: `{ success: boolean }`

### POST /api/v1/privacy/user/:userId/settings/bulk

- **Role**: `privacy:write`
- **Description**: Bulk update privacy settings
- **Body**: `{ settings: [{ settingType: string, enabled: boolean }] }`
- **Response**: `{ success: boolean, updated: number }`

## Privacy Setting Types

- `analytics_tracking` - Google Analytics and similar tracking
- `debug_tracking` - Sentry, debugging, and error tracking
- `cookie_consent` - Whether user has consented to cookies
- `performance_monitoring` - Performance and monitoring tools
- `error_reporting` - Error reporting services

## Error Handling

The API returns standard HTTP status codes:

- `200` - Success
- `400` - Bad Request (invalid parameters)
- `401` - Unauthorized (authentication failures: invalid, expired, or missing token)
- `403` - Forbidden (authorization failures: insufficient roles or wrong client)
- `404` - Not Found (user or setting not found)
- `500` - Internal Server Error

### Authentication vs Authorization Errors

- **401 Unauthorized**: Token is invalid, expired, malformed, missing, or has wrong audience/issuer
- **403 Forbidden**: Token is valid but lacks required roles or client authorization

## Security Considerations

1. **Token Expiration**: Access tokens have a limited lifetime (default 5 minutes). Implement token refresh logic.

2. **Role Validation**: Each endpoint validates that **ALL** required roles are present. A token must have every role listed in `@RequireRoles()`.

3. **Audience Validation**: Tokens must have the correct audience claim matching `KEYCLOAK_M2M_AUDIENCE` (defaults to 'account').

4. **Client Validation**: When using `@RequireClient()`, the token's `azp` or `client_id` must match exactly.

5. **Clock Skew Tolerance**: Token timestamps are validated with configurable clock skew tolerance (default 30 seconds).

6. **HTTPS Only**: Always use HTTPS in production for token exchange and API calls.

7. **Client Secret Security**: Keep client secrets secure and rotate them regularly.

8. **Rate Limiting**: Implement rate limiting on your client side to avoid overwhelming the API.

## Integration Example (Node.js)

```javascript
class PrivacyApiClient {
  constructor(keycloakUrl, realm, clientId, clientSecret, accountManagerUrl) {
    this.keycloakUrl = keycloakUrl;
    this.realm = realm;
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.accountManagerUrl = accountManagerUrl;
    this.accessToken = null;
    this.tokenExpiry = null;
  }

  async getAccessToken() {
    if (this.accessToken && this.tokenExpiry > Date.now()) {
      return this.accessToken;
    }

    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid_connect/token`;

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        role: 'privacy:read privacy:write',
      }),
    });

    const data = await response.json();
    this.accessToken = data.access_token;
    this.tokenExpiry = Date.now() + data.expires_in * 1000 - 30000; // 30s buffer

    return this.accessToken;
  }

  async getUserPrivacySettings(userId) {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.accountManagerUrl}/api/v1/privacy/user/${userId}/settings`, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get privacy settings: ${response.statusText}`);
    }

    return response.json();
  }

  async recordCookieConsent(userId) {
    const token = await this.getAccessToken();

    const response = await fetch(`${this.accountManagerUrl}/api/v1/privacy/user/${userId}/cookie-consent`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to record consent: ${response.statusText}`);
    }

    return response.json();
  }
}

// Usage
const client = new PrivacyApiClient('https://sso.cacic.dev.br', 'your-realm', 'privacy-api-client', 'your-client-secret', 'https://account.cacic.dev.br');

// Get user privacy settings
const settings = await client.getUserPrivacySettings('user-123');
console.log('Privacy settings:', settings);

// Record cookie consent
await client.recordCookieConsent('user-123');
```

## Testing

Use the provided curl examples or create a simple test script to verify the API is working correctly with your Keycloak setup.
