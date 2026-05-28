import { Routes } from '@angular/router';

export const profileRoutes: Routes = [
  {
    path: 'edit',
    loadComponent: () =>
      import('./edit/edit.component').then((m) => m.EditProfileComponent),
  },
  {
    path: 'sessions',
    loadComponent: () =>
      import('./sessions/sessions.component').then((m) => m.SessionsComponent),
  },
];
