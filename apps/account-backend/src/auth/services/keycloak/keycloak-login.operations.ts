import { KeycloakUser } from '../../interfaces/auth.interface';
import { KeycloakBaseOperations } from './keycloak-base.operations';

export abstract class KeycloakLoginOperations extends KeycloakBaseOperations {
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

    return `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/auth?${params.toString()}`;
  }

  getEndSessionUrl(postLogoutRedirectUri: string, idTokenHint?: string): string {
    const params = new URLSearchParams({
      client_id: this.clientId,
      post_logout_redirect_uri: postLogoutRedirectUri,
      ...(idTokenHint && { id_token_hint: idTokenHint }),
    });

    return `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/logout?${params.toString()}`;
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
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

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

    const response = await fetch(tokenUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to exchange code for tokens');
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in?: number;
      refresh_expires_in?: number;
    }>;
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
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

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

    const response = await fetch(tokenUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to exchange password credentials for tokens');
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
      id_token: string;
      expires_in?: number;
      refresh_expires_in?: number;
    }>;
  }

  async getUserInfo(accessToken: string): Promise<KeycloakUser> {
    const userInfoUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/userinfo`;

    const response = await fetch(userInfoUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to get user info');
    }

    const userInfo = (await response.json()) as KeycloakUser;

    this.logger.debug('Keycloak user info received', {
      sub: userInfo.sub,
      email: userInfo.email,
      name: userInfo.name,
      picture: userInfo.picture,
      pictureExists: !!userInfo.picture,
    });

    return userInfo;
  }

  async refreshToken(refreshToken: string): Promise<{
    access_token: string;
    refresh_token: string;
  }> {
    const tokenUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/token`;

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

    const response = await fetch(tokenUrl, {
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
        bodyPreview: details.bodyPreview,
      });

      throw new Error('Failed to refresh token');
    }

    return response.json() as Promise<{
      access_token: string;
      refresh_token: string;
    }>;
  }

  async logout(refreshToken: string): Promise<void> {
    const logoutUrl = `${this.keycloakUrl}/realms/${this.realm}/protocol/openid-connect/logout`;

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

    const response = await fetch(logoutUrl, {
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
        bodyPreview: details.bodyPreview,
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
