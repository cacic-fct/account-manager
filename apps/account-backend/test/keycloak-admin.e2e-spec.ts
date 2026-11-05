import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CurrentUserGuard } from '../src/auth/guards/current-user.guard';
import { createPkceChallenge } from '../src/auth/pkce.utils';
import { KeycloakService } from '../src/auth/services/keycloak.service';
import { waitForKeycloakRealm } from './auth-test-helpers';

// Only run through the isolated Compose test realm; never mutate a configured production realm.
const studentId = '22222222-2222-2222-2222-222222222222';
const externalId = '44444444-4444-4444-4444-444444444444';

describe('Keycloak Admin REST contracts (e2e)', () => {
  let service: KeycloakService;

  beforeAll(async () => {
    const baseUrl = process.env.KEYCLOAK_URL;
    if (
      process.env.NODE_ENV !== 'test' ||
      process.env.KEYCLOAK_ISOLATED_TEST_REALM !== 'true' ||
      !baseUrl ||
      new URL(baseUrl).hostname !== 'localhost'
    ) {
      throw new Error('Keycloak Admin tests require the isolated localhost test realm');
    }
    await waitForKeycloakRealm(baseUrl);
    service = new KeycloakService();
  });

  it('validates discovery, exact email lookups, attributes, group paths, and effective roles', async () => {
    await expect(service.isRealmReachable()).resolves.toBe(true);
    await expect(service.findUserByEmail(' ALUNO@UNESP.BR ')).resolves.toMatchObject({ id: studentId });
    await expect(service.getUserAttributes(studentId)).resolves.toMatchObject({ enrollmentNumber: ['222222'] });
    await expect(service.searchUsersByAttribute('enrollmentNumber', '222222')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: studentId })]),
    );
    await expect(service.searchUsersByAttribute('fullName', 'Aluno Unesp')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: studentId })]),
    );
    await expect(service.getUserGroups(studentId)).resolves.toContain('Unesp');
    await expect(service.getUserRoles(studentId)).resolves.toContain('access');
    await expect(service.listClientRoles('cacic-account-manager')).resolves.toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'access' })]),
    );
  });

  it('updates attributes without re-enabling a disabled user or losing unrelated attributes', async () => {
    const before = await service.getUserBasicInfo(externalId);
    if (!before) throw new Error('Missing external test user');
    try {
      await service.setUserEnabled(externalId, false);
      await service.updateUserAttributes(externalId, { displayName: ['API review test'] }, { skipValidation: true });
      await expect(service.getUserBasicInfo(externalId)).resolves.toMatchObject({ enabled: false });
      const attributes = await service.getUserAttributes(externalId);
      expect(attributes.displayName).toEqual(['API review test']);
      for (const [key, values] of Object.entries(before.attributes ?? {})) {
        if (key !== 'displayName') expect(attributes[key]).toEqual(values);
      }
    } finally {
      await service.setUserEnabled(externalId, before.enabled !== false);
      await service.updateUserAttributes(
        externalId,
        { displayName: before.attributes?.displayName ?? [] },
        { skipValidation: true },
      );
    }
  });

  it('keeps an existing session usable during a login lockout while still rejecting account deactivation', async () => {
    const baseUrl = process.env.KEYCLOAK_URL;
    const tokenResponse = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
      method: 'POST',
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: 'admin',
      }),
    });
    expect(tokenResponse.status).toBe(200);
    const rootToken = (await tokenResponse.json()) as { access_token: string };
    const realmUrl = `${baseUrl}/admin/realms/cacic-sso`;
    const headers = { Authorization: `Bearer ${rootToken.access_token}`, 'Content-Type': 'application/json' };
    const realmResponse = await fetch(realmUrl, { headers });
    expect(realmResponse.status).toBe(200);
    const realm = (await realmResponse.json()) as Record<string, unknown>;
    const settings = [
      'bruteForceProtected',
      'permanentLockout',
      'failureFactor',
      'waitIncrementSeconds',
      'minimumQuickLoginWaitSeconds',
      'maxFailureWaitSeconds',
    ];
    const originalSettings = Object.fromEntries(settings.map((key) => [key, realm[key]]));
    const guard = new CurrentUserGuard(service, new Reflector());
    const context = {
      getHandler: () => jest.fn(),
      getClass: () => class TestController {},
      switchToHttp: () => ({ getRequest: () => ({ session: { user: { keycloakId: externalId } } }) }),
    } as unknown as ExecutionContext;
    const lockoutUrl = `${realmUrl}/attack-detection/brute-force/users/${externalId}`;

    try {
      const update = await fetch(realmUrl, {
        method: 'PUT',
        headers,
        body: JSON.stringify({
          bruteForceProtected: true,
          permanentLockout: false,
          failureFactor: 1,
          waitIncrementSeconds: 120,
          minimumQuickLoginWaitSeconds: 120,
          maxFailureWaitSeconds: 120,
        }),
      });
      expect(update.status).toBe(204);
      await expect(service.exchangePasswordForTokens('externo@gmail.com', 'wrong-password')).rejects.toThrow();

      // Keycloak records failed logins asynchronously. Poll the isolated fixture
      // until its single-user endpoint exhibits the false disabled flag.
      let locked = false;
      for (let attempt = 0; attempt < 30; attempt += 1) {
        const response = await fetch(`${realmUrl}/users/${externalId}`, { headers });
        expect(response.status).toBe(200);
        const user = (await response.json()) as { enabled: boolean };
        if (user.enabled === false) {
          locked = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      expect(locked).toBe(true);
      await expect(guard.canActivate(context)).resolves.toBe(true);
      // Validation must not clear the login lockout or change the user record.
      const lockoutResponse = await fetch(lockoutUrl, { headers });
      expect(lockoutResponse.status).toBe(200);
      expect(await lockoutResponse.json()).toMatchObject({ disabled: true });

      await service.setUserEnabled(externalId, false);
      await expect(guard.canActivate(context)).rejects.toMatchObject({ response: { code: 'ACCOUNT_DISABLED' } });
    } finally {
      expect((await fetch(lockoutUrl, { method: 'DELETE', headers })).status).toBe(204);
      await service.setUserEnabled(externalId, true);
      expect((await fetch(realmUrl, { method: 'PUT', headers, body: JSON.stringify(originalSettings) })).status).toBe(
        204,
      );
    }
  });

  it('uses client UUIDs and full role representations for direct role assignment and removal', async () => {
    try {
      await service.addUserClientRoles(externalId, ['access']);
      await expect(service.getUserDirectRoles(externalId)).resolves.toContain('access');
    } finally {
      await service.removeUserClientRoles(externalId, ['access']);
    }
    await expect(service.getUserDirectRoles(externalId)).resolves.not.toContain('access');
  });

  it('joins and leaves a group resolved by its full path', async () => {
    try {
      await service.addUserToGroupPath(externalId, '/Unesp');
      await expect(service.getUserGroups(externalId)).resolves.toContain('Unesp');
    } finally {
      await service.removeUserFromGroupPath(externalId, '/Unesp');
    }
    await expect(service.getUserGroups(externalId)).resolves.not.toContain('Unesp');
  });

  it('refreshes login tokens and invalidates them through server-side logout', async () => {
    const tokens = await service.exchangePasswordForTokens('aluno@unesp.br', '1');
    await expect(service.getUserInfo(tokens.access_token, tokens.id_token)).resolves.toMatchObject({ sub: studentId });
    const refreshed = await service.refreshToken(tokens.refresh_token);
    await expect(service.getUserInfo(refreshed.access_token)).resolves.toMatchObject({ sub: studentId });
    await service.logout(refreshed.refresh_token);
    await expect(service.getUserInfo(refreshed.access_token)).rejects.toThrow('Token is not active.');
  });

  it('completes authorization code login with PKCE and signed proof of fresh authentication', async () => {
    const redirectUri = 'http://localhost:3000/api/auth/callback';
    const pkce = createPkceChallenge();
    const requestedAt = Date.now();
    const authorization = await fetch(
      service.getAuthUrl(redirectUri, 'test-state', {
        prompt: 'login',
        maxAge: 0,
        codeChallenge: pkce.challenge,
      }),
      { redirect: 'manual' },
    );
    expect(authorization.status).toBe(200);
    const html = await authorization.text();
    const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1]?.replace(/&amp;/g, '&');
    if (!action) throw new Error('Keycloak did not return a login form');
    const cookies = authorization.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';', 1)[0])
      .join('; ');
    const login = await fetch(action, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Cookie: cookies },
      body: new URLSearchParams({ username: 'aluno@unesp.br', password: '1', credentialId: '' }).toString(),
    });
    expect(login.status).toBe(302);
    const location = login.headers.get('location');
    if (!location) throw new Error('Keycloak did not return an authorization redirect');
    const callback = new URL(location);
    expect(callback.origin + callback.pathname).toBe(redirectUri);
    expect(callback.searchParams.get('state')).toBe('test-state');
    const code = callback.searchParams.get('code');
    if (!code) throw new Error('Keycloak did not return an authorization code');
    const tokens = await service.exchangeCodeForTokens(code, redirectUri, pkce.verifier);
    try {
      await expect(
        service.getUserInfo(tokens.access_token, tokens.id_token, {
          authenticatedAfter: requestedAt,
        }),
      ).resolves.toMatchObject({ sub: studentId });
    } finally {
      await service.logout(tokens.refresh_token);
    }
  });
});
