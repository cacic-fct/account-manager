import { Routes } from '@angular/router';

export const linkedAccountsRoutes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./linked-accounts.component').then(
        (m) => m.LinkedAccountsComponent,
      ),
  },
  {
    path: 'google',
    pathMatch: 'full',
    loadComponent: () =>
      import('./google/google-integration-page.component').then(
        (m) => m.GoogleIntegrationPageComponent,
      ),
  },
  {
    path: 'discord',
    pathMatch: 'full',
    loadComponent: () =>
      import('./discord/discord-integration-page.component').then(
        (m) => m.DiscordIntegrationPageComponent,
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
    path: 'unesp',
    pathMatch: 'full',
    loadComponent: () =>
      import(
        './student-verification/student-verification-page.component'
      ).then((m) => m.StudentVerificationPageComponent),
  },
  {
    path: 'unesp/student-verification',
    loadComponent: () =>
      import('./student-verification/verification-details.component').then(
        (m) => m.StudentVerificationDetailsComponent,
      ),
  },
];
