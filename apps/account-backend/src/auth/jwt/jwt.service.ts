import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

export interface JwtPayload {
  sub: string;
  iss: string;
  aud: string | string[];
  exp: number;
  iat: number;
  azp?: string; // Authorized party (client_id)
  scope?: string;
  client_id?: string;
  preferred_username?: string;
  realm_access?: {
    roles?: string[];
  };
  resource_access?: Record<string, { roles?: string[] }>;
  [key: string]: unknown;
}

interface ClientCredentialsTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  token_type?: unknown;
  scope?: string;
}

@Injectable()
export class JwtService {
  private readonly logger = new Logger(JwtService.name);
  private jwksClient: jwksClient.JwksClient;
  private readonly keycloakBaseUrl: string;
  private readonly realm: string;
  private readonly expectedAudience: string;
  private readonly clockSkewToleranceSeconds: number;
  private readonly requireServiceAccountToken: boolean;
  private readonly allowedM2MClients: string[];
  private readonly tokenCache = new Map<
    string,
    { accessToken: string; expiresAt: number }
  >();

  constructor(private configService: ConfigService) {
    this.keycloakBaseUrl = this.configService.get<string>('KEYCLOAK_URL') ?? '';
    this.realm = this.configService.get<string>('KEYCLOAK_REALM') ?? '';
    this.expectedAudience =
      this.configService.get<string>('KEYCLOAK_M2M_AUDIENCE') ?? 'account';
    this.clockSkewToleranceSeconds =
      this.configService.get<number>('JWT_CLOCK_SKEW_TOLERANCE') ?? 30;
    this.requireServiceAccountToken =
      this.configService.get<string>('KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT') !==
      'false';
    this.allowedM2MClients = this.configService
      .get<string>('KEYCLOAK_M2M_ALLOWED_CLIENTS', '')
      .split(',')
      .map((client) => client.trim())
      .filter(Boolean);

    if (!this.keycloakBaseUrl || !this.realm) {
      throw new Error('KEYCLOAK_URL and KEYCLOAK_REALM must be configured');
    }

    const jwksUri = `${this.keycloakBaseUrl}/realms/${this.realm}/protocol/openid-connect/certs`;

    this.jwksClient = jwksClient({
      jwksUri,
      requestHeaders: {},
      timeout: 30000,
      cache: true,
      cacheMaxEntries: 5,
      cacheMaxAge: 600000, // 10 minutes
      jwksRequestsPerMinute: 10,
      rateLimit: true,
    });
  }

  /**
   * Validates a JWT token against Keycloak's public keys
   */
  async validateToken(token: string): Promise<JwtPayload> {
    try {
      // Decode the token header to get the key ID
      const decoded = jwt.decode(token, { complete: true });

      if (!decoded || !decoded.header || !decoded.header.kid) {
        throw new UnauthorizedException('Invalid token format');
      }

      // Get the signing key from JWKS
      const key = await this.getSigningKey(decoded.header.kid);

      // Verify the token
      const payload = jwt.verify(token, key, {
        algorithms: ['RS256'],
        issuer: `${this.keycloakBaseUrl}/realms/${this.realm}`,
        clockTolerance: this.clockSkewToleranceSeconds,
      }) as JwtPayload;

      // Additional validation
      this.validateTokenPayload(payload);

      return payload;
    } catch (error) {
      this.logger.error('Token validation failed', error);

      if (error instanceof jwt.TokenExpiredError) {
        throw new UnauthorizedException('Token expired');
      }
      if (error instanceof jwt.NotBeforeError) {
        throw new UnauthorizedException('Token not active');
      }
      if (error instanceof jwt.JsonWebTokenError) {
        throw new UnauthorizedException('Invalid token');
      }

      throw new UnauthorizedException('Token validation failed');
    }
  }

  /**
   * Gets the signing key from JWKS
   */
  private async getSigningKey(kid: string): Promise<string> {
    try {
      const key = await this.jwksClient.getSigningKey(kid);
      return key.getPublicKey();
    } catch (error) {
      this.logger.error(`Failed to get signing key for kid: ${kid}`, error);
      throw new UnauthorizedException('Unable to verify token signature');
    }
  }

  /**
   * Validates the token payload for additional security checks
   */
  private validateTokenPayload(payload: JwtPayload): void {
    const now = Math.floor(Date.now() / 1000);

    // Check if token is expired (with clock skew tolerance)
    if (payload.exp && payload.exp < now - this.clockSkewToleranceSeconds) {
      throw new UnauthorizedException('Token expired');
    }

    // Check if token is not yet valid (with clock skew tolerance)
    if (payload.iat && payload.iat > now + this.clockSkewToleranceSeconds) {
      throw new UnauthorizedException('Token not yet valid');
    }

    // Validate issuer
    const expectedIssuer = `${this.keycloakBaseUrl}/realms/${this.realm}`;
    if (payload.iss !== expectedIssuer) {
      throw new UnauthorizedException('Invalid token issuer');
    }

    // Validate audience (aud claim)
    if (payload.aud) {
      const audiences = Array.isArray(payload.aud)
        ? payload.aud
        : [payload.aud];
      if (!audiences.includes(this.expectedAudience)) {
        this.logger.warn(
          `Token audience mismatch. Expected: ${this.expectedAudience}, Got: ${audiences.join(', ')}`,
        );
        throw new UnauthorizedException('Invalid token audience');
      }
    } else {
      this.logger.warn('Token missing audience claim');
      throw new UnauthorizedException('Token missing audience claim');
    }

    // Validate authorized party (azp) for client credentials flow
    if (!payload.azp && !payload.client_id) {
      this.logger.warn('Token missing authorized party (azp) or client_id');
      throw new UnauthorizedException(
        'Token missing authorized party or client_id',
      );
    }
  }

  /**
   * Extracts and validates token from Authorization header
   */
  extractTokenFromHeader(authHeader: string): string {
    if (!authHeader) {
      throw new UnauthorizedException('Authorization header missing');
    }

    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
      throw new UnauthorizedException('Invalid authorization header format');
    }

    return parts[1];
  }

  hasRequiredRealmRole(payload: JwtPayload, requiredRole: string): boolean {
    return payload.realm_access?.roles?.includes(requiredRole) ?? false;
  }

  hasRequiredRole(payload: JwtPayload, requiredRole: string): boolean {
    if (this.hasRequiredRealmRole(payload, requiredRole)) {
      return true;
    }

    return Object.values(payload.resource_access ?? {}).some((clientAccess) =>
      clientAccess.roles?.includes(requiredRole),
    );
  }

  hasRequiredClientRole(
    payload: JwtPayload,
    clientId: string,
    requiredRole: string,
  ): boolean {
    return (
      payload.resource_access?.[clientId]?.roles?.includes(requiredRole) ??
      false
    );
  }

  /**
   * Checks if the token is from a specific client
   */
  isFromClient(payload: JwtPayload, clientId: string): boolean {
    return payload.azp === clientId || payload.client_id === clientId;
  }

  getClientId(payload: JwtPayload): string | undefined {
    return payload.azp || payload.client_id;
  }

  isServiceAccountToken(payload: JwtPayload): boolean {
    if (!this.requireServiceAccountToken) {
      return true;
    }

    const clientId = this.getClientId(payload);
    return (
      !!clientId && payload.preferred_username === `service-account-${clientId}`
    );
  }

  isAllowedM2MClient(payload: JwtPayload): boolean {
    if (this.allowedM2MClients.length === 0) {
      return true;
    }

    const clientId = this.getClientId(payload);
    return !!clientId && this.allowedM2MClients.includes(clientId);
  }

  async getClientCredentialsToken(
    options: {
      audience?: string;
      clientId?: string;
      clientSecret?: string;
    } = {},
  ): Promise<string> {
    const clientId =
      options.clientId ||
      this.configService.get<string>('KEYCLOAK_M2M_CLIENT_ID') ||
      this.configService.get<string>('KEYCLOAK_CLIENT_ID');
    const clientSecret =
      options.clientSecret ||
      this.configService.get<string>('KEYCLOAK_M2M_CLIENT_SECRET') ||
      this.configService.get<string>('KEYCLOAK_CLIENT_SECRET');

    if (!clientId || !clientSecret) {
      throw new Error(
        'KEYCLOAK_M2M_CLIENT_ID and KEYCLOAK_M2M_CLIENT_SECRET must be configured for outbound M2M calls',
      );
    }

    const cacheKey = JSON.stringify({
      clientId,
      audience: options.audience || '',
    });
    const cached = this.tokenCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      return cached.accessToken;
    }

    const tokenUrl = `${this.keycloakBaseUrl}/realms/${this.realm}/protocol/openid-connect/token`;
    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', clientId);
    body.set('client_secret', clientSecret);

    if (options.audience) {
      body.set('audience', options.audience);
    }

    const response = await fetch(tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error('Failed to obtain M2M token from Keycloak', {
        status: response.status,
        statusText: response.statusText,
        clientId,
        error: errorText,
      });
      throw new UnauthorizedException('Unable to obtain M2M token');
    }

    const tokenResponse =
      (await response.json()) as ClientCredentialsTokenResponse;
    if (
      typeof tokenResponse.access_token !== 'string' ||
      !tokenResponse.access_token
    ) {
      throw new UnauthorizedException(
        'M2M token response missing access token',
      );
    }

    const expiresInSeconds =
      typeof tokenResponse.expires_in === 'number' &&
      tokenResponse.expires_in > 0
        ? tokenResponse.expires_in
        : 300;
    const ttlMs = Math.max(expiresInSeconds - 30, 1) * 1000;
    this.tokenCache.set(cacheKey, {
      accessToken: tokenResponse.access_token,
      expiresAt: Date.now() + ttlMs,
    });

    return tokenResponse.access_token;
  }
}
