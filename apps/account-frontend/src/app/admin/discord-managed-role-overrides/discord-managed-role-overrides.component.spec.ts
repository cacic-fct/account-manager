import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { DiscordManagedRoleDefinition, DiscordManagedRoleOverride, KeycloakPermissionUser } from '@cacic/shared-types';
import { ApiService } from '../../shared/services/api.service';
import { DiscordManagedRoleOverridesComponent } from './discord-managed-role-overrides.component';

type OverrideHarness = DiscordManagedRoleOverridesComponent & {
  searchForm: {
    controls: { query: { setValue: (value: string) => void } };
  };
  overrideForm: {
    controls: {
      roleCategory: { setValue: (value: string) => void };
      reason: { setValue: (value: string) => void };
    };
  };
  searchUsers: () => void;
  selectUser: (user: KeycloakPermissionUser) => void;
  saveOverride: () => void;
  selectOverride: (override: DiscordManagedRoleOverride) => void;
};

const mockCatalog: DiscordManagedRoleDefinition[] = [
  {
    category: 'student',
    roleId: '533901504537427968',
    roleName: 'Aluno da Computação',
    label: 'Aluno da Computação',
    description: 'Força o cargo de aluno.',
  },
  {
    category: 'visitor',
    roleId: '533902369692581909',
    roleName: 'Visitante externo',
    label: 'Visitante externo',
    description: 'Força o cargo de visitante.',
  },
];

const mockUser: KeycloakPermissionUser = {
  id: 'keycloak-user-1',
  email: 'student@example.com',
  displayName: 'Student User',
};

const mockOverride: DiscordManagedRoleOverride = {
  id: 'override-1',
  userId: mockUser.id,
  userEmail: mockUser.email,
  userDisplayName: mockUser.displayName,
  roleCategory: 'student',
  roleLabel: 'Aluno da Computação',
  roleId: '533901504537427968',
  roleName: 'Aluno da Computação',
  reason: 'Conferido manualmente.',
  createdAt: '2026-07-03T12:00:00.000Z',
  updatedAt: '2026-07-03T12:00:00.000Z',
};

describe('DiscordManagedRoleOverridesComponent', () => {
  let fixture: ComponentFixture<DiscordManagedRoleOverridesComponent>;
  let apiService: {
    getDiscordManagedRoleCatalog: ReturnType<typeof vi.fn>;
    getDiscordManagedRoleOverrides: ReturnType<typeof vi.fn>;
    searchKeycloakPermissionUsers: ReturnType<typeof vi.fn>;
    createDiscordManagedRoleOverride: ReturnType<typeof vi.fn>;
    updateDiscordManagedRoleOverride: ReturnType<typeof vi.fn>;
    deleteDiscordManagedRoleOverride: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiService = {
      getDiscordManagedRoleCatalog: vi.fn().mockReturnValue(of(mockCatalog)),
      getDiscordManagedRoleOverrides: vi.fn().mockReturnValue(of([])),
      searchKeycloakPermissionUsers: vi.fn().mockReturnValue(of([mockUser])),
      createDiscordManagedRoleOverride: vi.fn().mockReturnValue(of(mockOverride)),
      updateDiscordManagedRoleOverride: vi.fn().mockReturnValue(of(mockOverride)),
      deleteDiscordManagedRoleOverride: vi
        .fn()
        .mockReturnValue(of({ deleted: true, id: mockOverride.id, userId: mockUser.id })),
    };

    await TestBed.configureTestingModule({
      imports: [DiscordManagedRoleOverridesComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        { provide: ApiService, useValue: apiService },
        {
          provide: MatDialog,
          useValue: {
            open: vi.fn(() => ({ afterClosed: () => of(true) })),
          },
        },
        {
          provide: MatSnackBar,
          useValue: { open: vi.fn() },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DiscordManagedRoleOverridesComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads the hardcoded managed role catalog and override list', () => {
    expect(apiService.getDiscordManagedRoleCatalog).toHaveBeenCalled();
    expect(apiService.getDiscordManagedRoleOverrides).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Nova exceção');
    expect(fixture.nativeElement.textContent).toContain('Aluno da Computação');
  });

  it('creates an override for a searched Keycloak user with a reason', () => {
    const component = fixture.componentInstance as unknown as OverrideHarness;

    component.searchForm.controls.query.setValue('student');
    component.searchUsers();
    component.selectUser(mockUser);
    component.overrideForm.controls.roleCategory.setValue('student');
    component.overrideForm.controls.reason.setValue('Conferido manualmente.');
    component.saveOverride();

    expect(apiService.searchKeycloakPermissionUsers).toHaveBeenCalledWith('student');
    expect(apiService.createDiscordManagedRoleOverride).toHaveBeenCalledWith({
      userId: mockUser.id,
      roleCategory: 'student',
      reason: 'Conferido manualmente.',
    });
  });

  it('loads an existing override into edit mode', () => {
    const component = fixture.componentInstance as unknown as OverrideHarness;

    component.selectOverride(mockOverride);
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Editar exceção');
    expect(fixture.nativeElement.textContent).toContain(mockUser.displayName);
  });
});
