import { provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
import { HttpErrorResponse } from '@angular/common/http';
import type { User } from '@cacic/shared-types';
import { ApiService } from '../../services/api.service';
import { AuthService } from '../../services/auth/auth.service';
import { LoggerService } from '../../services/logger.service';
import { ProfileFormComponent } from './profile-form.component';

describe('ProfileFormComponent', () => {
  it('submits the selected passport country for a foreign user', async () => {
    const updatedUser: User = {
      id: 'user-id',
      keycloakId: 'user-id',
      username: 'user@example.com',
      email: 'user@example.com',
      fullname: 'Ana Example',
      displayName: 'Ana',
      phone: '+5518999990000',
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: 'AR',
      isOnboarded: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const updateProfile = vi.fn(() => of(updatedUser));

    await TestBed.configureTestingModule({
      imports: [ProfileFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { currentUser: signal(null), updateCurrentUser: vi.fn() } },
        {
          provide: ApiService,
          useValue: {
            checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
            updateProfile,
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: LoggerService, useValue: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileFormComponent);
    fixture.detectChanges();
    fixture.componentInstance.personalGroup.patchValue({
      fullname: updatedUser.fullname,
      phone: '18999990000',
      identityDocument: updatedUser.identityDocument,
      isForeigner: true,
      passportCountry: 'AR',
    });

    await fixture.componentInstance.submitProfile();

    expect(updateProfile).toHaveBeenCalledOnce();
    expect(updateProfile).toHaveBeenCalledWith(expect.objectContaining({
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: 'AR',
    }));
  });

  it('keeps entered data after a failure and clears the notice after a successful retry', async () => {
    const user = { id: 'user-id' } as User;
    const updateCurrentUser = vi.fn();
    const failure = new HttpErrorResponse({ status: 503, error: { message: 'private server details' } });
    const updateProfile = vi.fn()
      .mockReturnValueOnce(throwError(() => failure))
      .mockReturnValueOnce(of(user));

    await TestBed.configureTestingModule({
      imports: [ProfileFormComponent],
      providers: [
        provideZonelessChangeDetection(),
        { provide: AuthService, useValue: { currentUser: signal(null), updateCurrentUser } },
        {
          provide: ApiService,
          useValue: {
            checkUnespRoleRequired: () => of({ shouldShowUnespRoleSelection: false }),
            updateProfile,
          },
        },
        { provide: MatDialog, useValue: { open: vi.fn() } },
        { provide: LoggerService, useValue: { debug: vi.fn(), error: vi.fn(), warn: vi.fn() } },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(ProfileFormComponent);
    fixture.componentRef.setInput('layoutMode', 'all-in-one');
    fixture.detectChanges();
    const component = fixture.componentInstance;
    component.personalGroup.patchValue({
      fullname: 'Ana Example',
      phone: '18999990000',
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: 'AR',
    });
    const enteredData = component.profileForm.getRawValue();
    const savingChange = vi.spyOn(component.savingChange, 'emit');
    const saveError = vi.spyOn(component.saveError, 'emit');

    await component.submitProfile();
    fixture.detectChanges();

    expect(component.profileForm.getRawValue()).toEqual(enteredData);
    expect(component.isSubmitting()).toBe(false);
    expect(updateCurrentUser).not.toHaveBeenCalled();
    expect(saveError).toHaveBeenCalledWith(failure);
    const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
    expect(alert.textContent).toContain('Não foi possível concluir seu cadastro');
    expect(fixture.nativeElement.textContent).not.toContain('private server details');
    expect(fixture.nativeElement.textContent).toContain('Tentar salvar novamente');

    component.onSupportDetailsCopied(false);
    expect(component.copyFeedback()).toContain('Selecione e copie');
    component.onSupportDetailsCopied(true);
    expect(component.copyFeedback()).toContain('Detalhes copiados');

    await component.submitProfile();
    fixture.detectChanges();

    expect(updateProfile).toHaveBeenCalledTimes(2);
    expect(updateCurrentUser).toHaveBeenCalledWith(user);
    expect(component.submissionError()).toBeNull();
    expect(component.copyFeedback()).toBe('');
    expect(fixture.nativeElement.querySelector('[role="alert"]')).toBeNull();
    expect(savingChange.mock.calls).toEqual([[true], [false], [true], [false]]);
  });

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
