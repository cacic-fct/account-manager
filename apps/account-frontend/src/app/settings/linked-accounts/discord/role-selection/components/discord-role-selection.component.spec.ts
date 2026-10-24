import { HttpErrorResponse } from '@angular/common/http';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { DiscordRole } from '@cacic/shared-types';
import { of, throwError } from 'rxjs';
import { ApiService } from '../../../../../shared/services/api.service';
import { LoggerService } from '../../../../../shared/services/logger.service';
import { DiscordRoleSelectionComponent } from './discord-role-selection.component';

describe('Discord role update cooldown', () => {
  let fixture: ComponentFixture<DiscordRoleSelectionComponent>;
  const role: DiscordRole = {
    id: 'notifications',
    name: 'Notificações',
    color: '#000000',
    position: 1,
    hasPermissions: false,
    isBlacklisted: false,
    isEnabled: true,
    isManaged: false,
  };
  const updateUserDiscordRoles = vi.fn();

  beforeEach(async () => {
    updateUserDiscordRoles.mockReset();
    await TestBed.configureTestingModule({
      imports: [DiscordRoleSelectionComponent],
      providers: [
        {
          provide: ApiService,
          useValue: {
            getSelectableDiscordRoles: () => of([role]),
            getUserDiscordRoles: () => of({ currentRoles: [], availableRoles: [role] }),
            updateUserDiscordRoles,
          },
        },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
        { provide: LoggerService, useValue: { error: vi.fn() } },
      ],
    }).compileComponents();

    vi.useFakeTimers();
    fixture = TestBed.createComponent(DiscordRoleSelectionComponent);
    fixture.detectChanges();
    fixture.componentInstance.roleForm.get(role.id)?.setValue(true);
    fixture.detectChanges();
  });

  afterEach(() => {
    fixture.destroy();
    vi.useRealTimers();
  });

  it('keeps retry disabled for the server retry window after a reload or another tab changes it', () => {
    updateUserDiscordRoles.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 429, error: { attempts: 6, cooldownSeconds: 37 } })),
    );
    const component = fixture.componentInstance;

    component.saveChanges();
    fixture.detectChanges();

    expect(component.updateAttempts()).toBe(6);
    expect(component.remainingCooldown()).toBe(37);
    vi.advanceTimersByTime(2000);
    component.saveChanges();
    fixture.detectChanges();

    expect(updateUserDiscordRoles).toHaveBeenCalledOnce();
    expect(component.remainingCooldown()).toBe(35);
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(true);

    vi.advanceTimersByTime(35_000);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('button[type="submit"]').disabled).toBe(false);
  });

  it('also uses the cooldown returned when an update fails with HTTP 503', () => {
    updateUserDiscordRoles.mockReturnValue(
      throwError(() => new HttpErrorResponse({ status: 503, error: { attempts: 4, cooldownSeconds: 16 } })),
    );

    fixture.componentInstance.saveChanges();

    expect(fixture.componentInstance.updateAttempts()).toBe(4);
    expect(fixture.componentInstance.remainingCooldown()).toBe(16);
  });

  it.each([
    { body: { attempts: 6 }, attempts: 6, seconds: 64 },
    { body: { cooldownSeconds: 37 }, attempts: 1, seconds: 37 },
    { body: null, attempts: 1, seconds: 2 },
    { body: { attempts: '6', cooldownSeconds: '37' }, attempts: 1, seconds: 2 },
    { body: { attempts: -1, cooldownSeconds: 0 }, attempts: 1, seconds: 2 },
    { body: { attempts: 1.5, cooldownSeconds: Infinity }, attempts: 1, seconds: 2 },
    { body: { attempts: 31, cooldownSeconds: 2 ** 31 }, attempts: 1, seconds: 2 },
  ])('uses valid metadata and safe fallbacks for $body', ({ body, attempts, seconds }) => {
    updateUserDiscordRoles.mockReturnValue(throwError(() => new HttpErrorResponse({ status: 429, error: body })));

    fixture.componentInstance.saveChanges();

    expect(fixture.componentInstance.updateAttempts()).toBe(attempts);
    expect(fixture.componentInstance.remainingCooldown()).toBe(seconds);
  });
});
