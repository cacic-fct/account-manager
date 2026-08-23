import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import type { User } from '@cacic/shared-types';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth/auth.service';
import { LoggerService } from '../../services/logger.service';
import { ProfileFormComponent } from './profile-form.component';

describe('ProfileFormComponent subscriptions', () => {
  it('tears down form value observers when the component is destroyed', async () => {
    const user: User = {
      id: 'user-id',
      keycloakId: 'user-id',
      username: 'user@example.com',
      email: 'user@example.com',
      fullname: 'User',
      displayName: 'User',
      phone: '+5518999990000',
      identityDocument: '52998224725',
      isForeigner: false,
      isOnboarded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    await TestBed.configureTestingModule({
      imports: [ProfileFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: AuthService,
          useValue: { currentUser: signal(user) },
        },
        {
          provide: ApiService,
          useValue: { checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }) },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: LoggerService, useValue: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileFormComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    const emitFormState = vi.spyOn(component as unknown as { emitFormState: () => void }, 'emitFormState');

    component.personalGroup.get('fullname')?.setValue('Updated User');
    expect(emitFormState).toHaveBeenCalledOnce();

    emitFormState.mockClear();
    fixture.destroy();
    component.personalGroup.get('fullname')?.setValue('After Destroy');

    expect(emitFormState).not.toHaveBeenCalled();
  });
});
