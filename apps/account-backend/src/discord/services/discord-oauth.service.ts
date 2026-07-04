import { Injectable, BadRequestException } from '@nestjs/common';
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
      throw new BadRequestException('User ID is required');
    }

    const clientId = process.env.DISCORD_CLIENT_ID;
    if (!clientId) {
      throw new BadRequestException('Discord client ID not configured');
    }

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new BadRequestException('BACKEND_URL environment variable not configured');
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
        throw new BadRequestException('Invalid state parameter');
      }

      if (!timingSafeEqual(provided, expected)) {
        throw new BadRequestException('Invalid state parameter');
      }
    } catch {
      throw new BadRequestException('Invalid state parameter');
    }
  }

  /**
   * Exchange Discord OAuth code for access token
   */
  async exchangeCodeForToken(code: string): Promise<DiscordTokenResponse> {
    const clientId = process.env.DISCORD_CLIENT_ID;
    const clientSecret = process.env.DISCORD_CLIENT_SECRET;

    if (!clientId || !clientSecret) {
      throw new BadRequestException('Discord OAuth credentials not configured');
    }

    const backendUrl = process.env.BACKEND_URL;
    if (!backendUrl) {
      throw new BadRequestException('BACKEND_URL environment variable not configured');
    }

    const redirectUri = this.discordCallbackUrl(backendUrl);

    const params = new URLSearchParams();
    params.append('client_id', clientId);
    params.append('client_secret', clientSecret);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', redirectUri);

    const response = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params.toString(),
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to exchange Discord OAuth code');
    }

    return (await response.json()) as DiscordTokenResponse;
  }

  /**
   * Get Discord user information using access token
   */
  async getDiscordUserInfo(accessToken: string): Promise<DiscordUser> {
    const response = await fetch('https://discord.com/api/users/@me', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new BadRequestException('Failed to get Discord user information');
    }

    return (await response.json()) as DiscordUser;
  }

  private discordCallbackUrl(backendUrl: string): string {
    return `${createApiBaseUrl(backendUrl)}/discord/oauth/callback`;
  }
}
