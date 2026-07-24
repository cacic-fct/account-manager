import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AccountMergeRequest, KeycloakPermissionUser } from '@cacic/shared-types';
import { of, Subject, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ApiService } from '../../shared/services/api.service';
import { AdminAccountMergesComponent } from './admin-account-merges.component';

const firstUser: KeycloakPermissionUser = {
  id: 'first-user',
  email: 'first@example.com',
  displayName: 'First User',
};

const secondUser: KeycloakPermissionUser = {
  id: 'second-user',
  email: 'second@example.com',
  displayName: 'Second User',
};

const mergeRequest: AccountMergeRequest = {
  id: 'merge-request-1',
  status: 'pending',
  requesterUserId: firstUser.id,
  candidateUserId: secondUser.id,
  primaryUserId: firstUser.id,
  secondaryUserId: secondUser.id,
  primaryEmailOptions: [firstUser.email, secondUser.email],
  secondaryEmails: [],
  notificationSummary: { pending: 0, completed: 0, failed: 0 },
  scores: [],
  externalScores: [],
  expiresAt: '2026-07-23T12:00:00.000Z',
  createdAt: '2026-07-23T11:45:00.000Z',
};

type AccountMergeHarness = AdminAccountMergesComponent & {
  firstSearchForm: { controls: { query: { setValue: (value: string) => void } } };
  firstUsers: { (): KeycloakPermissionUser[] };
  firstUser: { set: (user: KeycloakPermissionUser) => void };
  secondUser: { set: (user: KeycloakPermissionUser) => void };
  mergeRequest: { (): AccountMergeRequest | null };
  searchFirstUser: () => void;
  createMergeRequest: () => void;
};

describe('AdminAccountMergesComponent', () => {
  let fixture: ComponentFixture<AdminAccountMergesComponent>;
  let apiService: {
    searchKeycloakPermissionUsers: ReturnType<typeof vi.fn>;
    createAdminAccountMerge: ReturnType<typeof vi.fn>;
    confirmAdminAccountMerge: ReturnType<typeof vi.fn>;
    cancelAdminAccountMerge: ReturnType<typeof vi.fn>;
    getAdminAccountMergeRequest: ReturnType<typeof vi.fn>;
    watchAdminAccountMergeRequest: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiService = {
      searchKeycloakPermissionUsers: vi.fn().mockReturnValue(of([firstUser])),
      createAdminAccountMerge: vi.fn().mockReturnValue(of(mergeRequest)),
      confirmAdminAccountMerge: vi.fn(),
      cancelAdminAccountMerge: vi.fn(),
      getAdminAccountMergeRequest: vi.fn(),
      watchAdminAccountMergeRequest: vi.fn(),
    };

    await TestBed.configureTestingModule({
      imports: [AdminAccountMergesComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ApiService, useValue: apiService },
        { provide: MatSnackBar, useValue: { open: vi.fn() } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminAccountMergesComponent);
    fixture.detectChanges();
  });

  it('searches for an enabled existing account', () => {
    const component = fixture.componentInstance as unknown as AccountMergeHarness;
    component.firstSearchForm.controls.query.setValue('first');

    component.searchFirstUser();

    expect(apiService.searchKeycloakPermissionUsers).toHaveBeenCalledWith('first');
    expect(component.firstUsers()).toEqual([firstUser]);
  });

  it('creates a merge request only after two distinct accounts are selected', () => {
    const component = fixture.componentInstance as unknown as AccountMergeHarness;

    component.createMergeRequest();

    expect(apiService.createAdminAccountMerge).not.toHaveBeenCalled();

    component.firstUser.set(firstUser);
    component.secondUser.set(firstUser);

    component.createMergeRequest();

    expect(apiService.createAdminAccountMerge).not.toHaveBeenCalled();

    apiService.createAdminAccountMerge.mockClear();
    component.secondUser.set(secondUser);

    component.createMergeRequest();

    expect(apiService.createAdminAccountMerge).toHaveBeenCalledWith({
      requesterUserId: firstUser.id,
      candidateUserId: secondUser.id,
    });
    expect(component.mergeRequest()).toEqual(mergeRequest);
  });

  it('filters disabled accounts and reports failed searches', () => {
    const component = fixture.componentInstance as unknown as AccountMergeHarness & {
      secondSearchForm: { controls: { query: { setValue: (value: string) => void } } };
      secondUsers: { (): KeycloakPermissionUser[] };
      searchSecondUser: () => void;
    };
    apiService.searchKeycloakPermissionUsers.mockReturnValueOnce(of([firstUser, { ...secondUser, enabled: false }]));
    component.firstSearchForm.controls.query.setValue('first');
    component.searchFirstUser();

    expect(component.firstUsers()).toEqual([firstUser]);

    apiService.searchKeycloakPermissionUsers.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    component.secondSearchForm.controls.query.setValue('second');
    component.searchSecondUser();

    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
      'Erro ao buscar contas no Keycloak.',
      'Fechar',
      { duration: 5000 },
    );
  });

  it('uses SSE deltas after confirmation and stops at a terminal status', () => {
    const component = fixture.componentInstance as unknown as AccountMergeHarness & {
      selectedPrimaryEmail: { set: (value: string) => void };
      confirming: { (): boolean };
      confirmMerge: () => void;
    };
    const updates = new Subject<Partial<AccountMergeRequest> & Pick<AccountMergeRequest, 'id'>>();
    apiService.confirmAdminAccountMerge.mockReturnValue(of({ request: { ...mergeRequest, status: 'pending_merge' } }));
    apiService.watchAdminAccountMergeRequest.mockReturnValue(updates);
    component.firstUser.set(firstUser);
    component.secondUser.set(secondUser);
    component.createMergeRequest();
    component.selectedPrimaryEmail.set(firstUser.email);

    component.confirmMerge();
    updates.next({ id: mergeRequest.id, status: 'completed' });

    expect(apiService.watchAdminAccountMergeRequest).toHaveBeenCalledWith(mergeRequest.id);
    expect(component.mergeRequest()?.status).toBe('completed');
    expect(updates.observed).toBe(false);
  });

  it('keeps form actions safe across invalid input and failed API operations', () => {
    const component = fixture.componentInstance as unknown as AccountMergeHarness & {
      secondSearchForm: { controls: { query: { setValue: (value: string) => void } } };
      searchSecondUser: () => void;
      selectedPrimaryEmail: { set: (value: string) => void };
      createMergeRequest: () => void;
      confirmMerge: () => void;
      cancelMerge: () => void;
      reset: () => void;
      progressValue: (score: number) => number;
    };
    const snackBar = TestBed.inject(MatSnackBar).open;

    component.searchSecondUser();
    expect(apiService.searchKeycloakPermissionUsers).not.toHaveBeenCalledWith('');

    component.firstUser.set(firstUser);
    component.secondUser.set(secondUser);
    apiService.createAdminAccountMerge.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    component.createMergeRequest();
    expect(snackBar).toHaveBeenCalledWith('Não foi possível iniciar a unificação das contas.', 'Fechar', { duration: 6000 });

    component.confirmMerge();
    component.mergeRequest.set(mergeRequest);
    component.selectedPrimaryEmail.set(firstUser.email);
    apiService.confirmAdminAccountMerge.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    component.confirmMerge();
    expect(snackBar).toHaveBeenCalledWith('Não foi possível confirmar a unificação.', 'Fechar', { duration: 6000 });

    apiService.cancelAdminAccountMerge.mockReturnValueOnce(throwError(() => new Error('unavailable')));
    component.cancelMerge();
    expect(snackBar).toHaveBeenCalledWith('Não foi possível cancelar a unificação.', 'Fechar', { duration: 6000 });

    component.reset();
    expect(component.mergeRequest()).toBeNull();
    expect(component.progressValue(-1)).toBe(0);
    expect(component.progressValue(101)).toBe(100);
  });
});
