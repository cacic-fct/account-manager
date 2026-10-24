import { ExecutionContext, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CurrentUserGuard } from '../../guards/current-user.guard';
import { KeycloakService } from '../keycloak.service';

type FetchMock = jest.Mock<Promise<Response>, Parameters<typeof fetch>>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('Keycloak account lookup and status validation', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  const userId = 'f:storage-provider:user/name?lookup=other#fragment';
  let fetchMock: FetchMock;
  let service: KeycloakService;
  let guard: CurrentUserGuard;
  let context: ExecutionContext;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      KEYCLOAK_URL: 'https://sso.example.test',
      KEYCLOAK_REALM: 'cacic',
      KEYCLOAK_CLIENT_ID: 'account-manager',
      KEYCLOAK_CLIENT_AUTH_METHOD: 'none',
      KEYCLOAK_ADMIN_CLIENT_ID: 'account-manager-admin',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'test-admin-secret',
    };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    fetchMock = jest.fn<Promise<Response>, Parameters<typeof fetch>>();
    global.fetch = fetchMock;
    service = new KeycloakService();
    guard = new CurrentUserGuard(service, new Reflector());
    context = {
      getHandler: () => jest.fn(),
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => ({ session: { user: { keycloakId: userId } } }) }),
    } as unknown as ExecutionContext;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  const mockLookup = (response: Response) => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ access_token: 'admin-token' })).mockResolvedValueOnce(response);
  };

  it('uses admin credentials and an encoded exact user URL with fresh JSON data', async () => {
    mockLookup(jsonResponse({ id: userId, enabled: true }));

    await expect(guard.canActivate(context)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const tokenRequest = fetchMock.mock.calls[0];
    expect(tokenRequest?.[0]).toBe('https://sso.example.test/realms/cacic/protocol/openid-connect/token');
    const requestBody = tokenRequest?.[1]?.body;
    if (typeof requestBody !== 'string') {
      throw new Error('Expected a form-encoded admin token request');
    }
    const tokenBody = new URLSearchParams(requestBody);
    expect(tokenBody.get('grant_type')).toBe('client_credentials');
    expect(tokenBody.get('client_id')).toBe('account-manager-admin');
    expect(tokenBody.get('client_secret')).toBe('test-admin-secret');
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      `https://sso.example.test/admin/realms/cacic/users/${encodeURIComponent(userId)}`,
    );
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      cache: 'no-store',
      redirect: 'error',
      headers: {
        Accept: 'application/json',
        Authorization: 'Bearer admin-token',
        'Cache-Control': 'no-cache, no-store',
      },
    });
  });

  it('does not confuse profile attributes, email verification, or access flags with account status', async () => {
    mockLookup(
      jsonResponse({
        id: userId,
        enabled: true,
        emailVerified: false,
        access: { manage: false },
        attributes: { enabled: ['false'], disabled: ['true'] },
      }),
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('does not flag an account when the optional enabled field is absent', async () => {
    mockLookup(jsonResponse({ id: userId, attributes: { enabled: ['false'] } }));

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('reports a disabled account only for a matching ID and an explicit boolean false', async () => {
    mockLookup(jsonResponse({ id: userId, enabled: false }));

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 403,
      response: { code: 'ACCOUNT_DISABLED' },
    });
  });

  it.each([
    { id: 'another-user', enabled: false },
    { enabled: false },
    [{ id: userId, enabled: false }],
    { id: userId, enabled: 'false' },
    { id: userId, enabled: 'true' },
    { id: userId, enabled: 0 },
    { id: userId, enabled: null },
    null,
  ])('treats malformed or mismatched account data as a service failure: %j', async (body) => {
    mockLookup(jsonResponse(body));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it.each([401, 403, 429, 500])('does not classify a failed user lookup (%s) as a disabled account', async (status) => {
    mockLookup(jsonResponse({ error: 'upstream failure', enabled: false }, status));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it('does not classify an admin authentication failure as a disabled account', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid_client' }, 401));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps a missing account distinct from a disabled account', async () => {
    mockLookup(jsonResponse({ error: 'User not found' }, 404));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 401 });
  });

  it('rejects HTML or invalid JSON as a service failure', async () => {
    mockLookup(new Response('<html>Sign in</html>', { headers: { 'Content-Type': 'text/html' } }));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it('rejects an unexpected empty success response as a service failure', async () => {
    mockLookup(new Response(null, { status: 204 }));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 503 });
  });

  it('reads the current account state again after an account is re-enabled', async () => {
    mockLookup(jsonResponse({ id: userId, enabled: false }));
    mockLookup(jsonResponse({ id: userId, enabled: true }));

    await expect(guard.canActivate(context)).rejects.toMatchObject({ status: 403 });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('rejects an empty user ID before making a request', async () => {
    await expect(service.getUserBasicInfo('')).rejects.toThrow('Keycloak user ID is required');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
