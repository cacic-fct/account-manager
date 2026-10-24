import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { SettingsComponent } from './settings.component';
import { AuthService } from '../shared/services/auth/auth.service';
import { linkedAccountsRoutes } from './linked-accounts/linked-accounts.routes';

describe('Settings navigation', () => {
  const currentUser = signal({ fullname: 'Marina Oliveira', email: 'marina@example.org', isAdmin: false });
  let element: HTMLElement;

  beforeEach(async () => {
    currentUser.set({ fullname: 'Marina Oliveira', email: 'marina@example.org', isAdmin: false });
    await TestBed.configureTestingModule({
      imports: [SettingsComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { currentUser, logout: () => undefined } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    element = fixture.nativeElement;
  });

  it('exposes every account task as a direct keyboard-accessible link', () => {
    const destinations = Array.from(element.querySelectorAll('nav a')).map((link) => link.getAttribute('href'));
    expect(destinations).toEqual([
      '/settings/profile/edit',
      '/settings/security/totp',
      '/settings/permissions',
      '/settings/linked-accounts/google',
      '/settings/linked-accounts/discord',
      '/settings/linked-accounts/unesp',
      '/settings/privacy/lgpd',
      '/settings/privacy',
    ]);
    expect(element.querySelector('a[href="/admin"]')).toBeNull();
  });

  it('shows the admin shortcut only for administrators', () => {
    currentUser.update((user) => ({ ...user, isAdmin: true }));
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/admin"]')).not.toBeNull();
  });

  it('preserves old menu URLs as exact redirects without intercepting detail pages', () => {
    for (const routes of [linkedAccountsRoutes]) {
      expect(routes[0]).toMatchObject({ path: '', pathMatch: 'full', redirectTo: '/settings' });
      expect(routes.slice(1).every((route) => !!route.loadComponent)).toBe(true);
    }
  });
});
