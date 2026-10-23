import { RenderMode, ServerRoute } from '@angular/ssr';
import type { Routes } from '@angular/router';
import { routes } from './app.routes';
import { adminRoutes } from './admin/admin.routes';
import { settingsRoutes } from './settings/settings.routes';
import { linkedAccountsRoutes } from './settings/linked-accounts/linked-accounts.routes';
import { privacyRoutes } from './settings/privacy/privacy.routes';
import { profileRoutes } from './settings/profile/profile.routes';
import { securityRoutes } from './settings/security/security.routes';

// Mirror lazy route groups without importing their page components into the client bundle.
const lazyRouteGroups: Readonly<Record<string, Routes>> = {
  admin: adminRoutes,
  settings: settingsRoutes,
  'settings/linked-accounts': linkedAccountsRoutes,
  'settings/privacy': privacyRoutes,
  'settings/profile': profileRoutes,
  'settings/security': securityRoutes,
};

function collectClientPaths(routeConfig: Routes, parentPath = ''): string[] {
  return routeConfig.flatMap((route) => {
    if (route.path === '**') {
      return [];
    }

    const path = [parentPath, route.path].filter(Boolean).join('/');
    const children = route.children ?? (route.loadChildren ? lazyRouteGroups[path] : undefined);
    if (route.loadChildren && !children) {
      throw new Error(`Missing server route mapping for lazy route: ${path}`);
    }

    return [path, ...(children ? collectClientPaths(children, path) : [])];
  });
}

export const serverRoutes: ServerRoute[] = [
  ...[...new Set(collectClientPaths(routes))].map((path): ServerRoute => ({ path, renderMode: RenderMode.Client })),
  {
    path: '**',
    renderMode: RenderMode.Server,
    status: 404,
    headers: {
      'Cache-Control': 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  },
];
