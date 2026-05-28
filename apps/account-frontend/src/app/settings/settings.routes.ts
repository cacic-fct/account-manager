import { Routes } from '@angular/router';

export const settingsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./settings.component').then((m) => m.SettingsComponent),
  },
  {
    path: 'profile',
    loadChildren: () =>
      import('./profile/profile.routes').then((m) => m.profileRoutes),
  },
  {
    path: 'linked-accounts',
    loadChildren: () =>
      import('./linked-accounts/linked-accounts.routes').then(
        (m) => m.linkedAccountsRoutes,
      ),
  },
  {
    path: 'privacy',
    loadChildren: () =>
      import('./privacy/privacy.routes').then((m) => m.privacyRoutes),
  },
];
