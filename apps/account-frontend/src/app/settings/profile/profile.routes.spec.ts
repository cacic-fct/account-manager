import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { of } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth/auth.service';
import { settingsRoutes } from '../settings.routes';
import { EditProfileComponent } from './edit/edit.component';
import { SessionsComponent } from './sessions/sessions.component';

describe('Profile routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideRouter([{ path: 'settings', children: settingsRoutes }]),
        { provide: AuthService, useValue: { currentUser: signal(null) } },
        {
          provide: ApiService,
          useValue: { checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }) },
        },
      ],
    });
  });

  it('opens the editor from the profile link without leaving an empty outlet', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/settings/profile', EditProfileComponent);

    expect(TestBed.inject(Router).url).toBe('/settings/profile/edit');
    expect(harness.routeNativeElement?.textContent).toContain('Editar perfil');
  });

  it('preserves query parameters and the fragment when opening the default profile page', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/settings/profile?source=account#personal', EditProfileComponent);

    expect(TestBed.inject(Router).url).toBe('/settings/profile/edit?source=account#personal');
  });

  it('keeps the explicit editor and sessions routes accessible', async () => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl('/settings/profile/edit', EditProfileComponent);
    expect(TestBed.inject(Router).url).toBe('/settings/profile/edit');

    await harness.navigateByUrl('/settings/profile/sessions', SessionsComponent);
    expect(TestBed.inject(Router).url).toBe('/settings/profile/sessions');
  });
});
