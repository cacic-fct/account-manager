import { APP_BASE_HREF } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { routes } from './app.routes';
import { NotFoundComponent } from './not-found/not-found.component';
import { AdminGuard } from './shared/services/auth/admin.guard';
import { AuthGuardWithForcedLogin } from './shared/services/auth/auth-guard-forced-login.service';

describe('Not-found routing', () => {
  const canActivate = vi.fn(() => false);

  beforeEach(() => {
    canActivate.mockClear();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        { provide: APP_BASE_HREF, useValue: '/app/' },
        { provide: AuthGuardWithForcedLogin, useValue: { canActivate } },
        { provide: AdminGuard, useValue: { canActivate } },
      ],
    });
  });

  it.each([
    '/nao-existe',
    '/applications/nao-existe',
    '/settings/nao-existe',
    '/settings/profile/nao-existe',
    '/settings/security/nao-existe',
    '/settings/privacy/nao-existe',
    '/settings/linked-accounts/nao-existe',
    '/admin/nao-existe',
  ])('renders a 404 at %s without redirecting to authentication', async (url) => {
    const harness = await RouterTestingHarness.create();

    await harness.navigateByUrl(url, NotFoundComponent);

    expect(TestBed.inject(Router).url).toBe(url);
    expect(harness.routeNativeElement?.querySelector('h1')?.textContent).toBe('Página não encontrada.');
    expect(TestBed.inject(Title).getTitle()).toBe('Página não encontrada | Conta CACiC');
    expect(canActivate).not.toHaveBeenCalled();
  });

  it('preserves query parameters and fragments while linking recovery to the app home', async () => {
    const harness = await RouterTestingHarness.create();
    const url = '/nao-existe?source=bookmark#section';

    await harness.navigateByUrl(url, NotFoundComponent);

    expect(TestBed.inject(Router).url).toBe(url);
    expect(harness.routeNativeElement?.querySelector('a')?.getAttribute('href')).toBe('/app/');
  });
});
