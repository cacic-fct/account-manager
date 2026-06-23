import { Routes } from '@angular/router';
import { AuthGuardWithForcedLogin } from './shared/services/auth/auth-guard-forced-login.service';
import { OnboardingGuard } from './shared/services/auth/onboarding.guard';
import { AdminGuard } from './shared/services/auth/admin.guard';

export const routes: Routes = [
  {
    path: '',
    loadComponent: () =>
      import('./home/home.component').then((m) => m.HomeComponent),
  },
  // {
  //   path: 'login',
  //   loadComponent: () =>
  //     import('./login/login.component').then((m) => m.LoginComponent),
  // },
  {
    path: 'login',
    redirectTo: '',
  },
  {
    path: 'onboarding',
    canActivate: [OnboardingGuard],
    loadComponent: () =>
      import('./onboarding/onboarding.component').then(
        (m) => m.OnboardingComponent,
      ),
  },
  {
    path: 'applications',
    canActivate: [AuthGuardWithForcedLogin],
    loadComponent: () =>
      import('./applications/applications.component').then(
        (m) => m.ApplicationsComponent,
      ),
  },
  {
    path: 'settings',
    canActivate: [AuthGuardWithForcedLogin],
    loadChildren: () =>
      import('./settings/settings.routes').then((m) => m.settingsRoutes),
  },
  {
    path: 'admin',
    canActivate: [AdminGuard],
    loadChildren: () =>
      import('./admin/admin.routes').then((m) => m.adminRoutes),
  },
  {
    path: '**',
    redirectTo: '/applications',
  },
];
