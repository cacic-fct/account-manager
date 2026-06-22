import { Routes } from '@angular/router';

export const adminRoutes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./admin.component').then((m) => m.AdminComponent),
  },
  {
    path: 'student-verification',
    loadComponent: () =>
      import(
        './student-verification/admin-student-verification.component'
      ).then((m) => m.AdminStudentVerificationComponent),
  },
  {
    path: 'discord-integration',
    loadComponent: () =>
      import('./discord-integration/discord-integration.component').then(
        (m) => m.DiscordIntegrationComponent,
      ),
  },
  {
    path: 'account-deletion',
    loadComponent: () =>
      import('./account-deletion/admin-account-deletion.component').then(
        (m) => m.AdminAccountDeletionComponent,
      ),
  },
  {
    path: 'keycloak-permissions',
    loadComponent: () =>
      import('./keycloak-permissions/keycloak-permissions.component').then(
        (m) => m.KeycloakPermissionsComponent,
      ),
  },
];
