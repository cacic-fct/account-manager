import { Routes } from '@angular/router';

export const securityRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    redirectTo: 'totp',
  },
  {
    path: 'totp',
    loadComponent: () =>
      import('./totp/totp.component').then((m) => m.TotpComponent),
  },
];
