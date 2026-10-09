import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { BehaviorSubject, of, Subject } from 'rxjs';
import type { User } from '@cacic/shared-types';
import { ApiService } from '../shared/services/api.service';
import { AuthService } from '../shared/services/auth/auth.service';
import { LoggerService } from '../shared/services/logger.service';
import { ProfileFormComponent } from '../shared/components/profile-form/profile-form.component';
import { OnboardingComponent } from './onboarding.component';

describe('OnboardingComponent profile initialization', () => {
  const cachedUser: User = {
    id: 'user-id',
    keycloakId: 'user-id',
    username: 'user@example.com',
    email: 'user@example.com',
    fullname: '',
    displayName: 'User',
    phone: '+5518999990000',
    identityDocument: '',
    isForeigner: false,
    isOnboarded: false,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  async function createOnboarding() {
    const currentUser = signal(cachedUser);
    const userResponse = new Subject<User>();
    const authLoaded = new BehaviorSubject(true);
    const getCurrentUser = vi.fn(() => userResponse);

    await TestBed.configureTestingModule({
      imports: [OnboardingComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: {
            currentUser,
            isDoneLoading$: authLoaded,
            isAuthenticated: () => true,
            isOnboarded: () => false,
            updateCurrentUser: (user: User) => currentUser.set(user),
          },
        },
        {
          provide: ApiService,
          useValue: {
            getCurrentUser,
            checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
          },
        },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: LoggerService, useValue: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(OnboardingComponent);
    fixture.componentInstance.sectionIndex.set(2);
    fixture.detectChanges();
    return { fixture, userResponse, authLoaded, getCurrentUser };
  }

  it('mounts the form with resolved user values and locks after a delayed response', async () => {
    const { fixture, userResponse, authLoaded, getCurrentUser } = await createOnboarding();
    expect(fixture.debugElement.query(By.directive(ProfileFormComponent))).toBeNull();

    const resolvedUser = {
      ...cachedUser,
      fullname: 'Ana Example',
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: 'AR',
    };
    userResponse.next(resolvedUser);
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(ProfileFormComponent)).componentInstance as ProfileFormComponent;
    expect(form.personalGroup.getRawValue()).toMatchObject({
      fullname: resolvedUser.fullname,
      identityDocument: resolvedUser.identityDocument,
      isForeigner: true,
      passportCountry: 'AR',
    });
    expect(form.personalGroup.get('identityDocument')?.disabled).toBe(true);
    expect(form.personalGroup.get('isForeigner')?.disabled).toBe(true);

    authLoaded.next(true);
    expect(getCurrentUser).toHaveBeenCalledOnce();
  });

  it('mounts the form with cached data when the user request fails', async () => {
    const { fixture, userResponse } = await createOnboarding();
    userResponse.error(new Error('User request failed'));
    fixture.detectChanges();

    const form = fixture.debugElement.query(By.directive(ProfileFormComponent)).componentInstance as ProfileFormComponent;
    expect(form.personalGroup.get('fullname')?.value).toBe(cachedUser.displayName);
    expect(form.personalGroup.get('identityDocument')?.enabled).toBe(true);
  });
});
