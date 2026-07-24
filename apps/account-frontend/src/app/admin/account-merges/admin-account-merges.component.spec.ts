import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { AccountMergeRequest, KeycloakPermissionUser } from '@cacic/shared-types';
import { of } from 'rxjs';
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
  };

  beforeEach(async () => {
    apiService = {
      searchKeycloakPermissionUsers: vi.fn().mockReturnValue(of([firstUser])),
      createAdminAccountMerge: vi.fn().mockReturnValue(of(mergeRequest)),
      confirmAdminAccountMerge: vi.fn(),
      cancelAdminAccountMerge: vi.fn(),
      getAdminAccountMergeRequest: vi.fn(),
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
    component.firstUser.set(firstUser);
    component.secondUser.set(secondUser);

    component.createMergeRequest();

    expect(apiService.createAdminAccountMerge).toHaveBeenCalledWith({
      requesterUserId: firstUser.id,
      candidateUserId: secondUser.id,
    });
    expect(component.mergeRequest()).toEqual(mergeRequest);
  });
});
