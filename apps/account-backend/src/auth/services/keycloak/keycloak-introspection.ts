import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';

export type KeycloakIntrospectionOptions = {
  realmUrl: string;
  clientId: string;
  clientSecret?: string;
  authMethod?: string;
  timeoutMs?: number;
};

export async function assertKeycloakAccessTokenActive(
  accessToken: string,
  options: KeycloakIntrospectionOptions,
): Promise<void> {
  if (
    !options.clientId.trim() ||
    !options.clientSecret ||
    (options.authMethod !== undefined &&
      options.authMethod !== 'client_secret_basic' &&
      options.authMethod !== 'client_secret_post')
  ) {
    throw new ServiceUnavailableException('Keycloak introspection requires confidential client authentication.');
  }

  const body = new URLSearchParams({ token: accessToken, token_type_hint: 'access_token' });
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (options.authMethod === 'client_secret_post') {
    body.set('client_id', options.clientId);
    body.set('client_secret', options.clientSecret);
  } else {
    const encode = (value: string) => new URLSearchParams({ value }).toString().slice('value='.length);
    headers.Authorization = `Basic ${Buffer.from(`${encode(options.clientId)}:${encode(options.clientSecret)}`).toString('base64')}`;
  }

  let introspection: unknown;
  try {
    const configuredTimeout = Number(options.timeoutMs ?? 10_000);
    const timeoutMs = Number.isSafeInteger(configuredTimeout) && configuredTimeout > 0 ? configuredTimeout : 10_000;
    const response = await fetch(`${options.realmUrl.replace(/\/+$/, '')}/protocol/openid-connect/token/introspect`, {
      method: 'POST',
      cache: 'no-store',
      redirect: 'error',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      throw new ServiceUnavailableException();
    }
    introspection = await response.json();
  } catch {
    throw new ServiceUnavailableException('Keycloak authentication is temporarily unavailable.');
  }

  if (
    !introspection ||
    typeof introspection !== 'object' ||
    Array.isArray(introspection) ||
    !('active' in introspection) ||
    typeof introspection.active !== 'boolean'
  ) {
    throw new ServiceUnavailableException('Keycloak returned an invalid introspection response.');
  }
  if (!introspection.active) {
    throw new UnauthorizedException('Token is not active.');
  }
}
