import { BadRequestException, ConflictException, Logger, UnauthorizedException } from '@nestjs/common';
import { generateKeyPairSync } from 'node:crypto';
import { sign } from 'jsonwebtoken';
import { KeycloakConnectionException } from '../../exceptions/keycloak-connection.exception';
import { KeycloakService } from '../keycloak.service';

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('Keycloak API contracts', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: KeycloakService;
  let fetchMock: jest.MockedFunction<typeof fetch>;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      NODE_ENV: 'test',
      KEYCLOAK_URL: 'https://sso.example.test/',
      KEYCLOAK_REALM: 'cacic realm',
      KEYCLOAK_CLIENT_ID: 'account-manager',
      KEYCLOAK_CLIENT_SECRET: 'login-secret',
      KEYCLOAK_ADMIN_CLIENT_SECRET: 'admin-secret',
      KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD: 'client_secret_basic',
    };
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
    service = new KeycloakService();
    jest.spyOn(service, 'getAdminToken').mockResolvedValue('admin-token');
    fetchMock = jest.fn();
    global.fetch = fetchMock;
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function requestBody(index: number): Record<string, unknown> {
    const body = fetchMock.mock.calls[index]?.[1]?.body;
    if (typeof body !== 'string') throw new Error('Expected a JSON request body');
    return JSON.parse(body) as Record<string, unknown>;
  }

  function requestUrl(index: number): URL {
    const input = fetchMock.mock.calls[index]?.[0];
    if (typeof input === 'string' || input instanceof URL) return new URL(input);
    throw new Error('Expected a request URL');
  }

  it('encodes user, realm, and group identifiers and rejects redirects for privileged mutations', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await service.addUserToGroupId('f:provider:user/name?x=y', 'group/name#fragment');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://sso.example.test/admin/realms/cacic%20realm/users/f%3Aprovider%3Auser%2Fname%3Fx%3Dy/groups/group%2Fname%23fragment',
      expect.objectContaining({ method: 'PUT', redirect: 'error', cache: 'no-store' }),
    );
  });

  it('does not replay security state while updating profile attributes', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          id: 'user-1',
          username: 'student',
          email: 'student@example.test',
          firstName: 'Student',
          enabled: true,
          emailVerified: true,
          requiredActions: ['UPDATE_PASSWORD'],
          attributes: { preserved: ['yes'] },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { preserved: ['yes'], unespRoleVerified: ['false'] } }));

    await service.updateUserAttributes('user-1', { unespRoleVerified: ['false'] }, { skipValidation: true });

    expect(requestBody(1)).toMatchObject({
      username: 'student',
      email: 'student@example.test',
      firstName: 'Student',
      attributes: { preserved: ['yes'], unespRoleVerified: ['false'] },
    });
    for (const key of ['id', 'enabled', 'emailVerified', 'requiredActions']) {
      expect(requestBody(1)).not.toHaveProperty(key);
    }
  });

  it('changes account status without resending attributes or other security fields', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          id: 'user-1',
          enabled: true,
          emailVerified: false,
          requiredActions: ['UPDATE_PASSWORD'],
          attributes: { unespRoleVerified: ['true'] },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await service.setUserEnabled('user-1', false);

    expect(requestBody(1)).toEqual({ enabled: false });
  });

  it('preserves unrelated attributes during general profile updates', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json({
          id: 'user-1',
          username: 'student',
          email: 'student@example.test',
          attributes: { preserved: ['yes'] },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    await service.updateUser('user-1', { attributes: { displayName: ['Student'] } });

    expect(requestBody(1)).toMatchObject({ attributes: { preserved: ['yes'], displayName: ['Student'] } });
  });

  it('rejects a mismatched account representation before writing', async () => {
    fetchMock.mockResolvedValue(json({ id: 'another-user', attributes: {} }));
    await expect(service.updateUserAttributes('user-1', {}, { skipValidation: true })).rejects.toBeInstanceOf(
      KeycloakConnectionException,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('serializes simultaneous attribute writes so the second read sees the first write', async () => {
    let attributes: Record<string, string[]> = {};
    let releaseWrite!: () => void;
    let notifyWriteStarted!: () => void;
    const blockedWrite = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const writeStarted = new Promise<void>((resolve) => {
      notifyWriteStarted = resolve;
    });
    let writes = 0;
    fetchMock.mockImplementation(async (_url, init) => {
      if (init?.method !== 'PUT') return json({ id: 'user-1', attributes });
      writes += 1;
      if (writes === 1) {
        notifyWriteStarted();
        await blockedWrite;
      }
      if (typeof init.body !== 'string') throw new Error('Expected a JSON request');
      const body = JSON.parse(init.body) as { attributes: Record<string, string[]> };
      attributes = body.attributes;
      return new Response(null, { status: 204 });
    });

    const first = service.updateUserAttributes('user-1', { first: ['saved'] }, { skipValidation: true });
    await writeStarted;
    const second = service.updateUserAttributes('user-1', { second: ['saved'] }, { skipValidation: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    releaseWrite();
    await Promise.all([first, second]);

    expect(attributes).toMatchObject({ first: ['saved'], second: ['saved'] });
  });

  it('surfaces Keycloak validation details instead of swallowing its own error', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: {} }))
      .mockResolvedValueOnce(json({ errors: [{ field: 'phone', errorMessage: 'error-invalid-value' }] }, 400));
    await expect(service.updateUserAttributes('user-1', {}, { skipValidation: true })).rejects.toThrow(
      'Validation failed: phone: error-invalid-value',
    );
  });

  it('does not report success when User Profile silently discards an attribute write', async () => {
    const notify = jest.fn<Promise<void>, [string]>();
    service.onUserUpdated(notify);
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: {} }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: {} }));
    await expect(
      service.updateUserAttributes('user-1', { unespRoleVerified: ['false'] }, { skipValidation: true }),
    ).rejects.toThrow('did not persist');
    expect(notify).not.toHaveBeenCalled();
  });

  it('accepts a saved patch when another replica changes an unrelated attribute before verification', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { displayName: ['Before'] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(
        json({
          id: 'user-1',
          attributes: { displayName: ['After'], unespRoleVerified: ['false'] },
        }),
      );

    await expect(
      service.updateUserAttributes('user-1', { unespRoleVerified: ['false'] }, { skipValidation: true }),
    ).resolves.toBeUndefined();
  });

  it('still rejects an explicit attribute removal that Keycloak did not persist', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { picture: ['old-picture'] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { picture: ['old-picture'] } }));

    await expect(service.updateUserAttributes('user-1', { picture: [] }, { skipValidation: true })).rejects.toThrow(
      'did not persist',
    );
  });

  it('still verifies removals of omitted attributes in replace mode', async () => {
    const attributes = { original: ['saved'], mergeState: ['pending'] };
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ id: 'user-1', attributes }));

    await expect(
      service.updateUserAttributes('user-1', { original: ['saved'] }, { skipValidation: true, mode: 'replace' }),
    ).rejects.toThrow('did not persist');
  });

  it('removes attributes introduced after a snapshot when restoring in replace mode', async () => {
    fetchMock
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { original: ['saved'], mergeState: ['pending'] } }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(json({ id: 'user-1', attributes: { original: ['saved'] } }));
    await service.updateUserAttributes('user-1', { original: ['saved'] }, { skipValidation: true, mode: 'replace' });
    expect(requestBody(1)).toMatchObject({ attributes: { original: ['saved'] } });
    expect(requestBody(1).attributes).not.toHaveProperty('mergeState');
  });

  it('checks discovery identity rather than accepting a proxy login page', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('<html>Login</html>'))
      .mockResolvedValueOnce(json({ issuer: 'https://another-issuer.example.test' }));
    await expect(service.isRealmReachable()).resolves.toBe(false);
    await expect(service.isRealmReachable()).resolves.toBe(false);
  });

  it('keeps underlying connection details out of public error responses', () => {
    const cause = new Error('internal connection details');
    const error = new KeycloakConnectionException('Authentication service unavailable', cause);
    expect(error.getResponse()).not.toHaveProperty('originalError');
    expect(error.cause).toBe(cause);
  });

  it('saves the verification decision and its metadata in one attribute mutation', async () => {
    const update = jest.spyOn(service, 'updateUserAttributes').mockResolvedValue();
    await service.verifyUserUnespRole('user-1', 'reviewer', 'document');
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        unespRoleVerified: ['true'],
        unespRoleVerificationMethod: ['document'],
        unespRoleVerifiedBy: ['reviewer'],
      }),
      { skipValidation: true },
    );
  });

  it('normalizes email lookups and rejects duplicate identities', async () => {
    fetchMock.mockResolvedValue(
      json([
        { id: 'user-1', email: 'student@example.test' },
        { id: 'user-2', email: 'student@example.test' },
      ]),
    );
    await expect(service.findUserByEmail(' Student@Example.Test ')).rejects.toBeInstanceOf(ConflictException);
    const url = requestUrl(0);
    expect(url.searchParams.get('email')).toBe('student@example.test');
    expect(url.searchParams.get('max')).toBe('2');
    expect(url.searchParams.get('exact')).toBe('true');
  });

  it('rejects an email lookup response that does not exactly match the requested email', async () => {
    fetchMock.mockResolvedValue(json([{ id: 'user-1', email: 'other@example.test' }]));
    await expect(service.findUserByEmail('student@example.test')).rejects.toBeInstanceOf(KeycloakConnectionException);
  });

  it('does not search an empty email', async () => {
    await expect(service.findUserByEmail(' ')).resolves.toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('quotes custom attribute queries so spaces and quotes cannot introduce other attribute filters', async () => {
    fetchMock.mockResolvedValue(json([]));
    await service.searchUsersByAttribute('fullName', 'Alice "Example" email:other');
    const url = requestUrl(0);
    expect(url.searchParams.get('q')).toBe('fullName:"Alice \\"Example\\" email:other"');
  });

  it.each([Number.NaN, Infinity, 1.5, -1, 0])('rejects an invalid result limit: %s', async (max) => {
    await expect(service.searchUsersByAttribute('fullName', 'Student', { max })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ['fullName:email', 'Student'],
    ['fullName', 'Student\\'],
  ])('rejects unsupported q syntax', async (name, value) => {
    await expect(service.searchUsersByAttribute(name, value)).rejects.toBeInstanceOf(BadRequestException);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a search outage instead of returning a successful empty result', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(new Response(null, { status: 503 })));
    await expect(service.searchUsers('Student')).rejects.toBeInstanceOf(KeycloakConnectionException);
  });

  it('retains successful user search branches when an optional attribute branch fails', async () => {
    fetchMock.mockImplementation((url) => {
      if (typeof url !== 'string') throw new Error('Expected a request URL');
      return Promise.resolve(
        new URL(url).searchParams.has('search')
          ? json([{ id: 'user-1', email: 'student@example.test' }])
          : new Response(null, { status: 400 }),
      );
    });
    await expect(service.searchUsers('Student')).resolves.toMatchObject([{ id: 'user-1' }]);
  });

  it.each(['different-identity', undefined])('rejects a federated identity conflict with %s', async (existingId) => {
    fetchMock
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json(existingId ? [{ identityProvider: 'google', userId: existingId }] : []));
    await expect(
      service.addFederatedIdentity('user-1', {
        identityProvider: 'google',
        userId: 'google-id',
        userName: 'Student',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('accepts an already linked identity only when both provider and identity ID match', async () => {
    fetchMock
      .mockResolvedValueOnce(json({}, 409))
      .mockResolvedValueOnce(json([{ identityProvider: 'google', userId: 'google-id', userName: 'Old name' }]));
    await expect(
      service.addFederatedIdentity('user-1', {
        identityProvider: 'google',
        userId: 'google-id',
        userName: 'New name',
      }),
    ).resolves.toBeUndefined();
  });

  it('reads every group page for name-based consumers too', async () => {
    fetchMock
      .mockResolvedValueOnce(
        json(Array.from({ length: 100 }, (_, index) => ({ id: `g-${index}`, name: `g-${index}` }))),
      )
      .mockResolvedValueOnce(json([{ id: 'unesp', name: 'unesp' }]));
    const groups = await service.getUserGroups('user-1');
    expect(groups).toHaveLength(101);
    expect(groups).toContain('unesp');
  });

  it('reports an applications outage instead of presenting an empty launcher', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(service.getUserApplications('user-1')).rejects.toBeInstanceOf(KeycloakConnectionException);
  });

  it.each([
    {},
    null,
    { access_token: '' },
    { access_token: 'access' },
    {
      access_token: 'access',
      refresh_token: 'refresh',
      id_token: 'id',
      expires_in: '300',
    },
  ])('rejects incomplete login token responses: %j', async (body) => {
    fetchMock.mockResolvedValue(json(body));
    await expect(
      service.exchangeCodeForTokens('code', 'https://account.example.test/callback', 'verifier'),
    ).rejects.toBeInstanceOf(KeycloakConnectionException);
  });

  it('rejects an admin token response before sending an undefined bearer token', async () => {
    jest.spyOn(service, 'getAdminToken').mockRestore();
    fetchMock.mockResolvedValue(json({}));
    await expect(service.getUserAttributes('user-1')).rejects.toBeInstanceOf(KeycloakConnectionException);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  describe('OpenID Connect identity binding', () => {
    const keys = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString();

    function idToken(overrides: Record<string, unknown> = {}) {
      const payload = {
        sub: 'user-1',
        iss: 'https://sso.example.test/realms/cacic%20realm',
        aud: 'account-manager',
        exp: Math.floor(Date.now() / 1000) + 300,
        ...overrides,
      };
      for (const key of Object.keys(overrides)) {
        if (overrides[key] === undefined) Reflect.deleteProperty(payload, key);
      }
      return sign(payload, keys.privateKey, { algorithm: 'RS256', keyid: 'test-key' });
    }

    beforeEach(() => {
      const instance = service as unknown as { idTokenKeys: { getSigningKey: jest.Mock } };
      instance.idTokenKeys = { getSigningKey: jest.fn().mockResolvedValue({ getPublicKey: () => publicKey }) };
      fetchMock.mockResolvedValueOnce(json({ active: true })).mockResolvedValueOnce(json({ sub: 'user-1' }));
    });

    it('accepts a verified identity token bound to matching userinfo', async () => {
      await expect(service.getUserInfo('access', idToken())).resolves.toMatchObject({ sub: 'user-1' });
    });

    it.each([
      { iss: 'https://another-issuer.example.test' },
      { aud: 'another-client' },
      { azp: 'another-client' },
      { aud: ['account-manager', 'another-client'] },
      { exp: 1 },
      { exp: undefined },
      { sub: undefined },
    ])('rejects invalid identity claims before requesting userinfo: %j', async (claims) => {
      await expect(service.getUserInfo('access', idToken(claims))).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('rejects a correctly signed token whose subject does not match userinfo', async () => {
      await expect(service.getUserInfo('access', idToken({ sub: 'other-user' }))).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('rejects a forged signature', async () => {
      const otherKeys = generateKeyPairSync('rsa', { modulusLength: 2048 });
      const instance = service as unknown as { idTokenKeys: { getSigningKey: jest.Mock } };
      instance.idTokenKeys.getSigningKey.mockResolvedValue({
        getPublicKey: () => otherKeys.publicKey.export({ type: 'spki', format: 'pem' }).toString(),
      });
      await expect(service.getUserInfo('access', idToken())).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it.each([undefined, 1])('rejects missing or stale auth_time for a fresh-login request', async (authTime) => {
      await expect(
        service.getUserInfo('access', idToken({ auth_time: authTime }), { authenticatedAfter: Date.now() }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('accepts signed confirmation of a fresh authentication', async () => {
      await expect(
        service.getUserInfo('access', idToken({ auth_time: Math.floor(Date.now() / 1000) }), {
          authenticatedAfter: Date.now(),
        }),
      ).resolves.toMatchObject({ sub: 'user-1' });
    });
  });
});
