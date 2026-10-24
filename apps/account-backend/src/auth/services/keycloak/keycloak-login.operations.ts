import { KeycloakUser } from '../../interfaces/auth.interface';
import { UnauthorizedException } from '@nestjs/common';
import * as jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';
import { KeycloakBaseOperations } from './keycloak-base.operations';
import { assertKeycloakAccessTokenActive } from './keycloak-introspection';
import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';

export abstract class KeycloakLoginOperations extends KeycloakBaseOperations {
  private readonly idTokenKeys = jwksClient({
    jwksUri: `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/certs`,
    timeout: 10_000,
    cache: true,
    rateLimit: true,
    jwksRequestsPerMinute: 10,
  });

  getAuthUrl(
    redirectUri: string,
    state?: string,
    options?: {
      prompt?: 'none' | 'login';
      maxAge?: number;
      codeChallenge?: string;
      codeChallengeMethod?: 'S256';
    },
  ): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: 'openid profile email',
      ...(this.loginIdpHint && { kc_idp_hint: this.loginIdpHint }),
      ...(state && { state }),
      ...(options?.prompt && { prompt: options.prompt }),
      ...(options?.maxAge !== undefined && { max_age: String(options.maxAge) }),
      ...(options?.codeChallenge && {
        code_challenge: options.codeChallenge,
        code_challenge_method: options.codeChallengeMethod ?? 'S256',
      }),
    });

    return `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/auth?${params.toString()}`;
  }

  // This URL is returned to browser code; identity tokens must remain server-side.
  getEndSessionUrl(postLogoutRedirectUri: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
    });

    return `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/logout?${params.toString()}`;
  }

  async exchangeCodeForTokens(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in?: number;
    refresh_expires_in?: number;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', this.clientId);
    body.set('code', code);
    body.set('redirect_uri', redirectUri);

    if (codeVerifier) {
      body.set('code_verifier', codeVerifier);
    }

    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    this.logger.debug('Exchanging authorization code for Keycloak tokens', {
      tokenUrl,
      clientId: this.clientId,
      clientAuthMethod: this.clientAuthMethod,
      redirectUri,
      pkce: !!codeVerifier,
      sendsAuthorizationHeader: !!headers.Authorization,
      sendsClientIdInBody: body.has('client_id'),
      sendsClientSecretInBody: body.has('client_secret'),
    });

    const response = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to exchange code for tokens', {
        status: response.status,
        statusText: response.statusText,
        tokenUrl,
        clientId: this.clientId,
        clientAuthMethod: this.clientAuthMethod,
        redirectUri,
        pkce: !!codeVerifier,
        sendsAuthorizationHeader: !!headers.Authorization,
        sendsClientIdInBody: body.has('client_id'),
        sendsClientSecretInBody: body.has('client_secret'),
        error: details.error,
        errorDescription: details.errorDescription,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to exchange code for tokens');
    }

    return this.readTokenResponse(response, ['access_token', 'refresh_token', 'id_token']);
  }

  async exchangePasswordForTokens(
    username: string,
    password: string,
  ): Promise<{
    access_token: string;
    refresh_token: string;
    id_token: string;
    expires_in?: number;
    refresh_expires_in?: number;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'password');
    body.set('client_id', this.clientId);
    body.set('username', username);
    body.set('password', password);
    body.set('scope', 'openid profile email phone identity-document academic-profile');

    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    this.logger.debug('Exchanging password credentials for Keycloak tokens', {
      tokenUrl,
      clientId: this.clientId,
      clientAuthMethod: this.clientAuthMethod,
      sendsAuthorizationHeader: !!headers.Authorization,
      sendsClientIdInBody: body.has('client_id'),
      sendsClientSecretInBody: body.has('client_secret'),
    });

    const response = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to exchange password credentials for tokens', {
        status: response.status,
        statusText: response.statusText,
        tokenUrl,
        clientId: this.clientId,
        clientAuthMethod: this.clientAuthMethod,
        sendsAuthorizationHeader: !!headers.Authorization,
        sendsClientIdInBody: body.has('client_id'),
        sendsClientSecretInBody: body.has('client_secret'),
        error: details.error,
        errorDescription: details.errorDescription,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to exchange password credentials for tokens');
    }

    return this.readTokenResponse(response, ['access_token', 'refresh_token', 'id_token']);
  }

  async getUserInfo(
    accessToken: string,
    idToken?: string,
    options: { authenticatedAfter?: number } = {},
  ): Promise<KeycloakUser> {
    const identity = idToken === undefined ? undefined : await this.verifyIdToken(idToken);
    if (options.authenticatedAfter !== undefined) {
      const authenticatedAt: unknown = identity?.auth_time;
      if (
        typeof authenticatedAt !== 'number' ||
        !Number.isFinite(authenticatedAt) ||
        authenticatedAt * 1000 < options.authenticatedAfter - 30_000 ||
        authenticatedAt * 1000 > Date.now() + 30_000
      ) {
        throw new UnauthorizedException('Keycloak did not confirm fresh authentication');
      }
    }
    await assertKeycloakAccessTokenActive(accessToken, {
      realmUrl: `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}`,
      clientId: this.clientId,
      clientSecret: this.clientSecret,
      authMethod: this.clientAuthMethod,
      timeoutMs: this.readPositiveInteger('KEYCLOAK_REQUEST_TIMEOUT_MS', 10_000),
    });
    const userInfoUrl = `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/userinfo`;

    const response = await this.fetchWithTimeout(userInfoUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to get Keycloak user info', {
        status: response.status,
        statusText: response.statusText,
        userInfoUrl,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to get user info');
    }

    const userInfo = (await response.json()) as KeycloakUser;
    if (!userInfo || typeof userInfo.sub !== 'string' || !userInfo.sub.trim()) {
      throw new KeycloakConnectionException('Authentication service returned invalid user information');
    }
    if (identity && userInfo.sub !== identity.sub) {
      throw new UnauthorizedException('Keycloak user information does not match the authenticated identity');
    }

    this.logger.debug('Keycloak user info received', {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      pictureExists: !!userInfo.picture,
    });

    return userInfo;
  }

  private async verifyIdToken(idToken: string): Promise<jwt.JwtPayload> {
    const decoded = jwt.decode(idToken, { complete: true });
    if (!decoded?.header.kid || decoded.header.alg !== 'RS256') {
      throw new UnauthorizedException('Invalid Keycloak identity token');
    }

    let key: jwksClient.SigningKey;
    try {
      key = await this.idTokenKeys.getSigningKey(decoded.header.kid);
    } catch (error) {
      if (error instanceof Error && error.name === 'SigningKeyNotFoundError') {
        throw new UnauthorizedException('Invalid Keycloak identity token signing key');
      }
      throw new KeycloakConnectionException('Unable to retrieve Keycloak identity signing keys');
    }

    try {
      const claims = jwt.verify(idToken, key.getPublicKey(), {
        algorithms: ['RS256'],
        issuer: `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}`,
        audience: this.clientId,
        clockTolerance: 30,
      });
      if (
        typeof claims !== 'object' ||
        typeof claims.sub !== 'string' ||
        !claims.sub.trim() ||
        typeof claims.exp !== 'number' ||
        typeof claims.iat !== 'number' ||
        claims.iat > Math.floor(Date.now() / 1000) + 30 ||
        (claims.azp !== undefined && claims.azp !== this.clientId) ||
        (Array.isArray(claims.aud) && claims.aud.length > 1 && claims.azp !== this.clientId)
      ) {
        throw new UnauthorizedException('Invalid Keycloak identity token claims');
      }
      return claims;
    } catch {
      throw new UnauthorizedException('Invalid Keycloak identity token');
    }
  }

  async refreshToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('client_id', this.clientId);
    body.set('refresh_token', refreshToken);

    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    this.logger.debug('Refreshing Keycloak token', {
      tokenUrl,
      clientId: this.clientId,
      clientAuthMethod: this.clientAuthMethod,
      sendsAuthorizationHeader: !!headers.Authorization,
      sendsClientIdInBody: body.has('client_id'),
      sendsClientSecretInBody: body.has('client_secret'),
    });

    const response = await this.fetchWithTimeout(tokenUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to refresh Keycloak token', {
        status: response.status,
        statusText: response.statusText,
        tokenUrl,
        clientId: this.clientId,
        clientAuthMethod: this.clientAuthMethod,
        sendsAuthorizationHeader: !!headers.Authorization,
        sendsClientIdInBody: body.has('client_id'),
        sendsClientSecretInBody: body.has('client_secret'),
        error: details.error,
        errorDescription: details.errorDescription,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to refresh token');
    }

    return this.readTokenResponse(response, ['access_token', 'refresh_token']);
  }

  async logout(refreshToken: string): Promise<void> {
    const logoutUrl = `${this.keycloakUrl}/realms/${encodeURIComponent(this.realm)}/protocol/openid-connect/logout`;

    const body = new URLSearchParams();
    body.set('client_id', this.clientId);
    body.set('refresh_token', refreshToken);

    const headers = this.createFormHeaders();
    this.appendClientAuthentication(body, headers);

    this.logger.debug('Logging out from Keycloak', {
      logoutUrl,
      clientId: this.clientId,
      clientAuthMethod: this.clientAuthMethod,
      sendsAuthorizationHeader: !!headers.Authorization,
      sendsClientIdInBody: body.has('client_id'),
      sendsClientSecretInBody: body.has('client_secret'),
    });

    const response = await this.fetchWithTimeout(logoutUrl, {
      method: 'POST',
      headers,
      body: body.toString(),
    });

    if (!response.ok) {
      const details = await this.readTokenError(response);

      this.logger.warn('Failed to logout from Keycloak', {
        status: response.status,
        statusText: response.statusText,
        logoutUrl,
        clientId: this.clientId,
        clientAuthMethod: this.clientAuthMethod,
        sendsAuthorizationHeader: !!headers.Authorization,
        sendsClientIdInBody: body.has('client_id'),
        sendsClientSecretInBody: body.has('client_secret'),
        error: details.error,
        errorDescription: details.errorDescription,
        contentType: details.contentType,
        responseHeaders: details.headers,
      });

      throw new Error('Failed to logout from Keycloak');
    }
  }

  private appendClientAuthentication(body: URLSearchParams, headers: Record<string, string>): void {
    if (this.clientAuthMethod === 'none') {
      return;
    }

    const clientSecret = this.getLoginClientSecret();

    if (this.clientAuthMethod === 'client_secret_post') {
      body.set('client_secret', clientSecret);
      return;
    }

    body.delete('client_id');
    headers.Authorization = `Basic ${this.getClientSecretBasicCredentials(clientSecret)}`;
  }

  private getLoginClientSecret(): string {
    if (!this.clientSecret) {
      throw new Error(
        ['KEYCLOAK_CLIENT_SECRET must be configured for', `${this.clientAuthMethod} authentication`].join(' '),
      );
    }

    return this.clientSecret;
  }

  private getClientSecretBasicCredentials(clientSecret: string): string {
    return Buffer.from(`${this.formEncode(this.clientId)}:${this.formEncode(clientSecret)}`, 'utf8').toString('base64');
  }

  private formEncode(value: string): string {
    const params = new URLSearchParams();
    params.set('value', value);
    return params.toString().slice('value='.length);
  }

  private createFormHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/x-www-form-urlencoded',
    };
  }
}
