import { KeycloakService } from './keycloak.service';

type FetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    statusText: init.statusText,
    headers: {
      'Content-Type': 'application/json',
    },
  });

describe('KeycloakService client roles', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      KEYCLOAK_URL: 'https://sso.example.test',
      KEYCLOAK_REALM: 'cacic',
      KEYCLOAK_CLIENT_ID: 'cacic-account-manager',
      KEYCLOAK_ADMIN_CLIENT_ID: 'admin-cli',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'secret',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reads user roles from the configured Keycloak client role mappings', async () => {
    const fetchMock: FetchMock = jest.fn<
      Promise<Response>,
      Parameters<typeof fetch>
    >();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'client-uuid',
            clientId: 'cacic-account-manager',
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse([{ name: 'access' }, { name: 'super-admin' }]),
      );
    global.fetch = fetchMock;

    const service = new KeycloakService();

    await expect(service.getUserRoles('user-1')).resolves.toEqual([
      'access',
      'super-admin',
    ]);

    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://sso.example.test/admin/realms/cacic/clients?clientId=cacic-account-manager',
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://sso.example.test/admin/realms/cacic/users/user-1/role-mappings/clients/client-uuid/composite',
    );
  });

  it('assigns roles through the configured Keycloak client role mappings', async () => {
    const fetchMock: FetchMock = jest.fn<
      Promise<Response>,
      Parameters<typeof fetch>
    >();
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(
        jsonResponse([
          {
            id: 'client-uuid',
            clientId: 'cacic-account-manager',
          },
        ]),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          id: 'role-uuid',
          name: 'super-admin',
          clientRole: true,
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ access_token: 'admin-token' }))
      .mockResolvedValueOnce(jsonResponse({}));
    global.fetch = fetchMock;

    const service = new KeycloakService();

    await service.addUserClientRoles('user-1', ['super-admin']);

    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      'https://sso.example.test/admin/realms/cacic/clients/client-uuid/roles/super-admin',
    );
    expect(fetchMock.mock.calls[4]?.[0]).toBe(
      'https://sso.example.test/admin/realms/cacic/users/user-1/role-mappings/clients/client-uuid',
    );
    expect(fetchMock.mock.calls[4]?.[1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify([
        {
          id: 'role-uuid',
          name: 'super-admin',
          clientRole: true,
        },
      ]),
    });
  });

  it('includes the client secret when exchanging an authorization code for tokens', async () => {
    process.env.KEYCLOAK_CLIENT_SECRET = 'account-client-secret';
    const fetchMock: FetchMock = jest.fn<
      Promise<Response>,
      Parameters<typeof fetch>
    >();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        id_token: 'id-token',
      }),
    );
    global.fetch = fetchMock;

    const service = new KeycloakService();

    await service.exchangeCodeForTokens(
      'authorization-code',
      'https://account.example.test/api/auth/callback',
    );

    const tokenRequest = fetchMock.mock.calls[0];
    expect(tokenRequest?.[0]).toBe(
      'https://sso.example.test/realms/cacic/protocol/openid-connect/token',
    );

    const requestInit = tokenRequest?.[1];
    expect(requestInit?.method).toBe('POST');

    const requestBody = requestInit?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected token request body to be a string.');
    }

    const requestParams = new URLSearchParams(requestBody);
    expect(requestParams.get('grant_type')).toBe('authorization_code');
    expect(requestParams.get('client_id')).toBe('cacic-account-manager');
    expect(requestParams.get('code')).toBe('authorization-code');
    expect(requestParams.get('redirect_uri')).toBe(
      'https://account.example.test/api/auth/callback',
    );
    expect(requestParams.get('client_secret')).toBe('account-client-secret');
  });
});
