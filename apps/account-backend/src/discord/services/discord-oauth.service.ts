import { Injectable, BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { randomBytes, timingSafeEqual } from 'crypto';
import { createApiBaseUrl } from '../../config/app.config';

interface DiscordTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
}

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string;
  discriminator: string;
  avatar?: string; // Avatar hash
}

@Injectable()
export class DiscordOAuthService {
  generateOAuthState(): string {
    return randomBytes(32).toString('hex');
  }

  /**
   * Get Discord OAuth URL for linking
   */
  getDiscordAuthUrl(userId: string): { authUrl: string; state: string } {
    if (typeof userId !== 'string' || !userId.trim()) {
      throw new BadRequestException('Entre novamente para vincular sua conta do Discord.');
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      throw new ServiceUnavailableException(
        'A vinculação com o Discord não está disponível agora. Fale com o suporte.',
      );
    }

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new ServiceUnavailableException(
        'A vinculação com o Discord não está disponível agora. Fale com o suporte.',
      );
    }

    const redirectUri = this.discordCallbackUrl(backendUrl);
    const state = this.generateOAuthState();

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('redirect_uri', redirectUri);
    params.append('response_type', 'code');
    params.append('scope', 'identify');
    params.append('state', state);

    return {
      authUrl: `https://discord.com/api/oauth2/authorize?${params.toString()}`,
      state,
    };
  }

  /**
   * Verify OAuth state parameter
   */
  verifyOAuthState(state: string, expectedState: string): void {
    try {
      const provided = Buffer.from(state, 'utf-8');
      const expected = Buffer.from(expectedState, 'utf-8');

      if (provided.length !== expected.length) {
        throw new BadRequestException('A tentativa de vinculação expirou ou é inválida. Inicie novamente.');
      }

      if (!timingSafeEqual(provided, expected)) {
        throw new BadRequestException('A tentativa de vinculação expirou ou é inválida. Inicie novamente.');
      }
    } catch {
      throw new BadRequestException('A tentativa de vinculação expirou ou é inválida. Inicie novamente.');
    }
  }

  /**
   * Exchange Discord OAuth code for access token
   */
  async exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new ServiceUnavailableException(
        'A vinculação com o Discord não está disponível agora. Fale com o suporte.',
      );
    }

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new ServiceUnavailableException(
        'A vinculação com o Discord não está disponível agora. Fale com o suporte.',
      );
    }

    const redirectUri = this.discordCallbackUrl(backendUrl);

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    let response: Response;
    try {
      response = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: params.toString(),
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('Não foi possível conectar ao Discord. Tente novamente em alguns minutos.');
    }

    if (!response.ok) {
      throw new BadRequestException('A tentativa de vinculação expirou. Inicie novamente.');
    }

    return (await response.json()) as DiscordTokenResponse;
  }

  /**
   * Get Discord user information using access token
   */
  async getDiscordUserInfo(accessToken: string): Promise<DiscordUser> {
    let response: Response;
    try {
      response = await fetch('https://discord.com/api/users/@me', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      throw new ServiceUnavailableException('Não foi possível conectar ao Discord. Tente novamente em alguns minutos.');
    }

    if (!response.ok) {
      throw new BadRequestException('Não foi possível verificar a conta do Discord. Inicie a vinculação novamente.');
    }

    return (await response.json()) as DiscordUser;
  }

  private discordCallbackUrl(backendUrl: string): string {
    return `${createApiBaseUrl(backendUrl)}/discord/oauth/callback`;
  }
}
