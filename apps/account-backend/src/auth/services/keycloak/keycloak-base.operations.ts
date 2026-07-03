import { Logger } from '@nestjs/common';
import { KeycloakClientAuthMethod, KeycloakTokenError } from './keycloak.types';

export abstract class KeycloakBaseOperations {
  protected readonly logger = new Logger('KeycloakService');
  protected readonly keycloakUrl: string;
  protected readonly realm: string;
  protected readonly clientId: string;
  protected readonly clientAuthMethod: KeycloakClientAuthMethod;
  protected readonly clientSecret?: string;
  protected readonly adminClientId: string;
  protected readonly adminClientSecret?: string;
  protected readonly loginIdpHint?: string;
  protected readonly clientUuidCache = new Map<string, string>();
  private readonly realmHealthCheckTimeoutMs = 5_000;

  constructor() {
    this.keycloakUrl = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_URL',
      'http://localhost:8080',
    );
    this.realm = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_REALM',
      'cacic-sso',
    );
    this.clientId = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_CLIENT_ID',
      'cacic-account-manager',
    );
    this.clientAuthMethod = this.resolveClientAuthMethod();
    this.clientSecret = this.resolveClientSecret();
    this.adminClientId = this.readEnvWithDevelopmentFallback(
      'KEYCLOAK_ADMIN_CLIENT_ID',
      'cacic-account-manager-admin-client',
    );
    this.adminClientSecret = this.resolveAdminClientSecret();
    this.loginIdpHint = this.resolveLoginIdpHint();

    if (this.isProduction() && !this.adminClientSecret) {
      throw new Error(
        'KEYCLOAK_ADMIN_CLIENT_SECRET must be configured in production',
      );
    }
  }

  /**
   * Determine if an error is due to connectivity issues with Keycloak
   */
  protected isConnectionError(error: unknown): boolean {
    const connectionErrorMessages = [
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
      'ECONNRESET',
      'fetch failed',
      'Network request failed',
      'Failed to fetch',
    ];

    if (error instanceof Error) {
      return connectionErrorMessages.some(
        (msg) =>
          error.message.includes(msg) ||
          (error.cause instanceof Error && error.cause.message.includes(msg)),
      );
    }

    if (typeof error === 'string') {
      return connectionErrorMessages.some((msg) => error.includes(msg));
    }

    return false;
  }

  protected readEnvWithDevelopmentFallback(
    name: string,
    developmentFallback: string,
  ): string {
    const value = this.readOptionalEnv(name);
    if (value) {
      return value;
    }

    if (this.isProduction()) {
      throw new Error(`${name} must be configured in production`);
    }

    this.logger.warn(`${name} is not configured; using development fallback`, {
      developmentFallback,
    });
    return developmentFallback;
  }

  protected readOptionalEnv(name: string): string | undefined {
    const value = process.env[name]?.trim();
    return value ? value : undefined;
  }

  protected isProduction(): boolean {
    return process.env.NODE_ENV === 'production';
  }

  async isRealmReachable(): Promise<boolean> {
    const configurationUrl = `${this.keycloakUrl}/realms/${this.realm}/.well-known/openid-configuration`;
    const abortController = new AbortController();
    const timeout = setTimeout(
      () => abortController.abort(),
      this.realmHealthCheckTimeoutMs,
    );

    try {
      const response = await fetch(configurationUrl, {
        signal: abortController.signal,
      });
      return response.ok;
    } catch (error) {
      if (this.isConnectionError(error)) {
        this.logger.warn('Keycloak realm health check failed', {
          configurationUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        return false;
      }

      this.logger.warn('Keycloak realm health check returned an error', {
        configurationUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    } finally {
      clearTimeout(timeout);
    }
  }

  protected resolveClientAuthMethod(): KeycloakClientAuthMethod {
    const configuredMethod =
      this.readOptionalEnv('KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD') ??
      this.readOptionalEnv('KEYCLOAK_CLIENT_AUTH_METHOD');

    if (!configuredMethod) {
      const hasClientSecret =
        !!this.readOptionalEnv('KEYCLOAK_CLIENT_SECRET') ||
        !this.isProduction();
      return hasClientSecret || this.isProduction()
        ? 'client_secret_basic'
        : 'none';
    }

    if (
      configuredMethod === 'client_secret_basic' ||
      configuredMethod === 'client_secret_post' ||
      configuredMethod === 'none'
    ) {
      return configuredMethod;
    }

    throw new Error(
      [
        'KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD must be client_secret_basic,',
        'client_secret_post, or none',
      ].join(' '),
    );
  }

  protected resolveClientSecret(): string | undefined {
    const secret = this.readOptionalEnv('KEYCLOAK_CLIENT_SECRET');

    if (this.clientAuthMethod === 'none') {
      if (secret) {
        this.logger.warn(
          [
            'KEYCLOAK_CLIENT_SECRET is configured but',
            'token endpoint auth method is none; login token requests will',
            'not send it',
          ].join(' '),
        );
      }

      return undefined;
    }

    if (secret) {
      return secret;
    }

    if (this.isProduction()) {
      throw new Error(
        [
          'KEYCLOAK_CLIENT_SECRET must be configured in production for the',
          'Keycloak login client. Set KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD=none',
          'only when KEYCLOAK_CLIENT_ID is a public client.',
        ].join(' '),
      );
    }

    this.logger.warn(
      [
        'KEYCLOAK_CLIENT_SECRET is not configured; using static development',
        'secret for the local Keycloak realm',
      ].join(' '),
    );
    return 'cacic-account-manager-dev-secret';
  }

  protected resolveAdminClientSecret(): string | undefined {
    const secret = this.readOptionalEnv('KEYCLOAK_ADMIN_CLIENT_SECRET');

    if (secret) {
      return secret;
    }

    if (this.isProduction()) {
      return undefined;
    }

    this.logger.warn(
      [
        'KEYCLOAK_ADMIN_CLIENT_SECRET is not configured; using static',
        'development secret for the local Keycloak realm',
      ].join(' '),
    );
    return 'cacic-account-manager-admin-client-dev-secret';
  }

  protected resolveLoginIdpHint(): string | undefined {
    if (this.isProduction()) {
      return 'google';
    }

    const configured = process.env['KEYCLOAK_LOGIN_IDP_HINT'];

    if (configured !== undefined) {
      const value = configured.trim();
      return value ? value : undefined;
    }

    return undefined;
  }

  protected getAdminClientSecret(): string {
    if (!this.adminClientSecret) {
      throw new Error(
        [
          'KEYCLOAK_ADMIN_CLIENT_SECRET must be configured for Keycloak admin',
          'API calls',
        ].join(' '),
      );
    }

    return this.adminClientSecret;
  }

  protected readResponseDebugHeaders(
    response: Response,
  ): Record<string, string | undefined> {
    return {
      contentType: response.headers.get('content-type') ?? undefined,
      contentLength: response.headers.get('content-length') ?? undefined,
      wwwAuthenticate: response.headers.get('www-authenticate') ?? undefined,
      server: response.headers.get('server') ?? undefined,
      via: response.headers.get('via') ?? undefined,
      cfRay: response.headers.get('cf-ray') ?? undefined,
      cfCacheStatus: response.headers.get('cf-cache-status') ?? undefined,
      location: response.headers.get('location') ?? undefined,
      xRequestId: response.headers.get('x-request-id') ?? undefined,
      xCorrelationId: response.headers.get('x-correlation-id') ?? undefined,
      xForwardedHost: response.headers.get('x-forwarded-host') ?? undefined,
      xFrameOptions: response.headers.get('x-frame-options') ?? undefined,
    };
  }

  /**
   * Reads token endpoint errors safely.
   *
   * Important: Response bodies can only be consumed once. This method reads text
   * first, then parses JSON from that text if possible.
   */
  protected async readTokenError(
    response: Response,
  ): Promise<KeycloakTokenError> {
    const headers = this.readResponseDebugHeaders(response);
    const contentType = response.headers.get('content-type') ?? '';

    try {
      const bodyPreview = await response.text();

      if (contentType.includes('application/json') && bodyPreview) {
        try {
          const body = JSON.parse(bodyPreview) as Record<string, unknown>;

          return {
            error: this.readString(body['error']),
            errorDescription:
              this.readString(body['error_description']) ??
              this.readString(body['errorDescription']),
            bodyPreview: bodyPreview.slice(0, 1000),
            contentType,
            headers,
          };
        } catch {
          return {
            bodyPreview: bodyPreview.slice(0, 1000),
            contentType,
            headers,
          };
        }
      }

      return {
        bodyPreview: bodyPreview ? bodyPreview.slice(0, 1000) : undefined,
        contentType: contentType || undefined,
        headers,
      };
    } catch (error) {
      return {
        bodyPreview:
          error instanceof Error
            ? `Failed to read response body: ${error.message}`
            : 'Failed to read response body',
        contentType: contentType || undefined,
        headers,
      };
    }
  }

  protected readString(value: unknown): string | undefined {
    return typeof value === 'string' && value ? value : undefined;
  }
}
