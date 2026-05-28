import { Routes } from '@angular/router';

export const linkedAccountsRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./linked-accounts.component').then(
        (m) => m.LinkedAccountsComponent,
      ),
  },
  {
    path: 'discord/role-selection',
    loadComponent: () =>
      import('./discord/role-selection/role-selection.component').then(
        (m) => m.RoleSelectionComponent,
      ),
  },
  {
    path: 'discord/server-access',
    loadComponent: () =>
      import('./discord/server-access/server-access.component').then(
        (m) => m.DiscordServerAccessComponent,
      ),
  },
  {
    path: 'unesp/student-verification',
    loadComponent: () =>
      import('./student-verification/verification-details.component').then(
        (m) => m.StudentVerificationDetailsComponent,
      ),
  },
];
