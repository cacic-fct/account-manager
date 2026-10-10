import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { assertKeycloakAccessTokenActive, KeycloakIntrospectionOptions } from './keycloak-introspection';

describe('Keycloak access-token introspection', () => {
  const originalFetch = global.fetch;
  const options: KeycloakIntrospectionOptions = {
    realmUrl: 'https://sso.example/realms/cacic',
    clientId: 'account client',
    clientSecret: 's:ecret',
  };
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    fetchMock = jest.fn().mockResolvedValue(new Response(JSON.stringify({ active: true })));
    global.fetch = fetchMock;
  });

  afterEach(() => { global.fetch = originalFetch; });

  it.each(['client_secret_basic', 'client_secret_post'])(
    'checks active state with %s authentication', async (authMethod) => {
      await expect(assertKeycloakAccessTokenActive('access', { ...options, authMethod })).resolves.toBeUndefined();
      expect(fetchMock).toHaveBeenCalledWith(
        `${options.realmUrl}/protocol/openid-connect/token/introspect`,
        expect.objectContaining({ method: 'POST', signal: expect.any(AbortSignal) }),
      );
      const request = fetchMock.mock.calls[0][1];
      const body = new URLSearchParams(String(request?.body));
      expect(body.get('token')).toBe('access');
      expect(body.get('token_type_hint')).toBe('access_token');
      if (authMethod === 'client_secret_basic') {
        expect(new Headers(request?.headers).get('Authorization')).toBe(
          `Basic ${Buffer.from('account+client:s%3Aecret').toString('base64')}`,
        );
      } else {
        expect(body.get('client_id')).toBe(options.clientId);
        expect(body.get('client_secret')).toBe(options.clientSecret);
      }
    },
  );

  it.each([{ active: false }, {}, { active: 'true' }, null])('rejects inactive or malformed responses: %p', async (data) => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify(data)));
    await expect(assertKeycloakAccessTokenActive('access', options)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('fails closed for network errors, HTTP failures, and invalid JSON', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    await expect(assertKeycloakAccessTokenActive('access', options)).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await expect(assertKeycloakAccessTokenActive('access', options)).rejects.toBeInstanceOf(ServiceUnavailableException);
    fetchMock.mockResolvedValueOnce(new Response('invalid JSON'));
    await expect(assertKeycloakAccessTokenActive('access', options)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('requires a confidential introspection client', async () => {
    await expect(assertKeycloakAccessTokenActive('access', { ...options, clientSecret: undefined }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(assertKeycloakAccessTokenActive('access', { ...options, authMethod: 'none' }))
      .rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
