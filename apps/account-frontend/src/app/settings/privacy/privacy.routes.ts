import { Routes } from '@angular/router';

export const privacyRoutes: Routes = [
  {
    path: '',
    loadComponent: () => import('./privacy.component').then((m) => m.PrivacyComponent),
  },
  {
    path: 'analytics',
    loadComponent: () => import('./analytics/analytics.component').then((m) => m.AnalyticsComponent),
  },
  {
    path: 'lgpd',
    loadComponent: () => import('./lgpd/lgpd.component').then((m) => m.LgpdComponent),
  },
];
