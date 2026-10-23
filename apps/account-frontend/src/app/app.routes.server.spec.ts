import { RenderMode } from '@angular/ssr';
import { serverRoutes } from './app.routes.server';

describe('Server routes', () => {
  it.each([
    '',
    'login',
    'onboarding',
    'applications',
    'settings',
    'settings/profile',
    'settings/profile/edit',
    'settings/profile/sessions',
    'settings/linked-accounts/discord/server-access',
    'settings/privacy/lgpd',
    'settings/security/totp',
    'admin/keycloak-permissions',
  ])('keeps %s client-rendered without an error status', (path) => {
    expect(serverRoutes.find((route) => route.path === path)).toEqual({ path, renderMode: RenderMode.Client });
  });

  it('server-renders unknown routes with HTTP 404 and prevents caching and indexing', () => {
    expect(serverRoutes.at(-1)).toEqual({
      path: '**',
      renderMode: RenderMode.Server,
      status: 404,
      headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
    });
    expect(new Set(serverRoutes.map((route) => route.path)).size).toBe(serverRoutes.length);
  });
});
