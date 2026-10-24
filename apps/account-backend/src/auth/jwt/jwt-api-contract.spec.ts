import { ConfigService } from '@nestjs/config';
import { Logger, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { JwtService } from './jwt.service';

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

describe('Keycloak M2M API contracts', () => {
  const originalFetch = global.fetch;
  let fetchMock: jest.MockedFunction<typeof fetch>;
  let service: JwtService;
  const config: Record<string, string> = {
    KEYCLOAK_URL: 'https://sso.example.test/',
    KEYCLOAK_REALM: 'cacic',
    KEYCLOAK_CLIENT_ID: 'account-manager',
    KEYCLOAK_CLIENT_SECRET: 'login-secret',
    KEYCLOAK_M2M_AUDIENCE: 'account-manager-audience',
    KEYCLOAK_M2M_ALLOWED_CLIENTS: 'event-manager-m2m',
    KEYCLOAK_M2M_CLIENT_ID: 'account-manager-m2m',
    KEYCLOAK_M2M_CLIENT_SECRET: 'outbound-secret',
    KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_post',
    KEYCLOAK_CLIENT_AUTH_METHOD: 'client_secret_basic',
  };

  beforeEach(() => {
    fetchMock = jest.fn();
    global.fetch = fetchMock;
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    service = new JwtService({ get: (key: string) => config[key] } as ConfigService);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('checks the returned target audience instead of relying on an ignored audience form parameter', async () => {
    const token = sign({ aud: ['event-manager-audience'] }, 'test-secret');
    fetchMock.mockResolvedValue(json({ access_token: token, expires_in: 300, token_type: 'Bearer' }));

    await expect(service.getClientCredentialsToken({ audience: 'event-manager-audience' })).resolves.toBe(token);
    const request = fetchMock.mock.calls[0]?.[1];
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://sso.example.test/realms/cacic/protocol/openid-connect/token');
    expect(request).toMatchObject({ cache: 'no-store', redirect: 'error' });
    if (typeof request?.body !== 'string') throw new Error('Expected a form request');
    expect(new URLSearchParams(request.body).has('audience')).toBe(false);
  });

  it.each([{}, { aud: 'other-service' }])(
    'rejects a token without the requested target audience: %j',
    async (payload) => {
      fetchMock.mockResolvedValue(json({ access_token: sign(payload, 'test-secret'), expires_in: 300 }));
      await expect(service.getClientCredentialsToken({ audience: 'event-manager-audience' })).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
    },
  );

  it('does not reuse cached or in-flight tokens across different client secrets', async () => {
    let sequence = 0;
    fetchMock.mockImplementation(() => Promise.resolve(json({ access_token: `token-${++sequence}`, expires_in: 300 })));
    await expect(
      Promise.all([
        service.getClientCredentialsToken({ clientSecret: 'old-secret' }),
        service.getClientCredentialsToken({ clientSecret: 'new-secret' }),
      ]),
    ).resolves.toEqual(['token-1', 'token-2']);
    await expect(service.getClientCredentialsToken({ clientSecret: 'new-secret' })).resolves.toBe('token-2');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not invent a cache lifetime when expires_in is absent', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(json({ access_token: 'uncached-token' })));
    await service.getClientCredentialsToken();
    await service.getClientCredentialsToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not extend a short token lifetime to a minimum of one second', async () => {
    let now = 100_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    fetchMock.mockImplementation(() => Promise.resolve(json({ access_token: 'short-token', expires_in: 0.1 })));
    await service.getClientCredentialsToken();
    now += 101;
    await service.getClientCredentialsToken();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    null,
    {},
    { access_token: ' ' },
    { access_token: 'token', token_type: 'DPoP' },
    {
      access_token: 'token',
      expires_in: -1,
    },
    { access_token: 'token', expires_in: '300' },
  ])('rejects malformed M2M token responses: %j', async (body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('keeps provider failures distinct from caller authentication failures', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network failed'));
    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(json({ error: 'invalid_client' }, 401));
    await expect(service.getClientCredentialsToken()).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  describe('incoming signed tokens', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    function token(overrides: Record<string, unknown> = {}) {
      const payload = {
        sub: 'service-account-1',
        iss: 'https://sso.example.test/realms/cacic',
        aud: 'account-manager-audience',
        azp: 'event-manager-m2m',
        exp: Math.floor(Date.now() / 1000) + 300,
        ...overrides,
      };
      for (const key of Object.keys(overrides)) {
        if (overrides[key] === undefined) Reflect.deleteProperty(payload, key);
      }
      return sign(payload, keys.privateKey, { algorithm: 'RS256', keyid: 'test-key' });
    }

    const signingKeyClient = () =>
      service as unknown as {
        jwksClient: { getSigningKey: jest.Mock };
      };

    beforeEach(() => {
      signingKeyClient().jwksClient = { getSigningKey: jest.fn().mockResolvedValue({ getPublicKey: () => publicKey }) };
    });

    it('uses the same client authentication configuration precedence as interactive login', async () => {
      fetchMock.mockResolvedValue(json({ active: true }));
      await expect(service.validateToken(token())).resolves.toMatchObject({ sub: 'service-account-1' });
      const request = fetchMock.mock.calls[0]?.[1];
      expect(new Headers(request?.headers).has('Authorization')).toBe(false);
      if (typeof request?.body !== 'string') throw new Error('Expected a form request');
      expect(new URLSearchParams(request.body).get('client_secret')).toBe('login-secret');
    });

    it.each([{ sub: undefined }, { exp: undefined }])(
      'rejects missing required claims before introspection',
      async (claims) => {
        await expect(service.validateToken(token(claims))).rejects.toBeInstanceOf(UnauthorizedException);
        expect(fetchMock).not.toHaveBeenCalled();
      },
    );

    it('reports a JWKS outage as unavailable while rejecting an unknown signing key as unauthorized', async () => {
      signingKeyClient().jwksClient.getSigningKey.mockRejectedValueOnce(new Error('network failed'));
      await expect(service.validateToken(token())).rejects.toBeInstanceOf(ServiceUnavailableException);
      const missingKey = new Error('unknown signing key');
      missingKey.name = 'SigningKeyNotFoundError';
      signingKeyClient().jwksClient.getSigningKey.mockRejectedValueOnce(missingKey);
      await expect(service.validateToken(token())).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
