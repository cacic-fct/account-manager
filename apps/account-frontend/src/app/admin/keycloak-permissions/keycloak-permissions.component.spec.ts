import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { PermissionGroupKey } from '@cacic/shared-types';
import { ApiService } from '../../shared/services/api.service';
import {
  mockDirectKeycloakPermissionGrant,
  mockKeycloakPermissionCatalog,
  mockKeycloakPermissionUsers,
  mockPermissionGroupCatalog,
  mockPermissionGroupRoleGrants,
  mockStudentEntityMemberships,
} from '../../../storybook/mocks/component-mocks';
import { PermissionsComponent } from './keycloak-permissions.component';

type PermissionsComponentHarness = PermissionsComponent & {
  searchForm: { controls: { query: { setValue: (value: string) => void } } };
  searchUsers: () => void;
  selectUser: (user: (typeof mockKeycloakPermissionUsers)[number]) => void;
};

describe('PermissionsComponent', () => {
  let fixture: ComponentFixture<PermissionsComponent>;
  let apiService: {
    getKeycloakPermissionCatalog: ReturnType<typeof vi.fn>;
    getPermissionGroupCatalog: ReturnType<typeof vi.fn>;
    getPermissionGroupRoleGrants: ReturnType<typeof vi.fn>;
    getPermissionGroupMemberships: ReturnType<typeof vi.fn>;
    searchKeycloakPermissionUsers: ReturnType<typeof vi.fn>;
    getKeycloakPermissionGrants: ReturnType<typeof vi.fn>;
    getUserPermissionGroupMemberships: ReturnType<typeof vi.fn>;
    updatePermissionGroupRoleGrants: ReturnType<typeof vi.fn>;
    createPermissionGroupMembership: ReturnType<typeof vi.fn>;
    createKeycloakPermissionGrant: ReturnType<typeof vi.fn>;
    deleteKeycloakPermissionGrant: ReturnType<typeof vi.fn>;
    deletePermissionGroupMembership: ReturnType<typeof vi.fn>;
    syncKeycloakPermissionGrants: ReturnType<typeof vi.fn>;
  };

  beforeEach(async () => {
    apiService = {
      getKeycloakPermissionCatalog: vi
        .fn()
        .mockReturnValue(of(mockKeycloakPermissionCatalog)),
      getPermissionGroupCatalog: vi
        .fn()
        .mockReturnValue(of(mockPermissionGroupCatalog)),
      getPermissionGroupRoleGrants: vi.fn((groupKey: PermissionGroupKey) =>
        of(
          mockPermissionGroupRoleGrants.filter(
            (grant) => grant.groupKey === groupKey,
          ),
        ),
      ),
      getPermissionGroupMemberships: vi.fn((groupKey: PermissionGroupKey) =>
        of(
          mockStudentEntityMemberships.filter(
            (membership) => membership.groupKey === groupKey,
          ),
        ),
      ),
      searchKeycloakPermissionUsers: vi
        .fn()
        .mockReturnValue(of(mockKeycloakPermissionUsers.slice(0, 2))),
      getKeycloakPermissionGrants: vi
        .fn()
        .mockReturnValue(of([mockDirectKeycloakPermissionGrant])),
      getUserPermissionGroupMemberships: vi.fn((userId: string) =>
        of(
          mockStudentEntityMemberships.filter(
            (membership) => membership.userId === userId,
          ),
        ),
      ),
      updatePermissionGroupRoleGrants: vi.fn().mockReturnValue(of([])),
      createPermissionGroupMembership: vi.fn().mockReturnValue(of(null)),
      createKeycloakPermissionGrant: vi
        .fn()
        .mockReturnValue(of(mockDirectKeycloakPermissionGrant)),
      deleteKeycloakPermissionGrant: vi
        .fn()
        .mockReturnValue(of({ deleted: true, id: 'grant-1' })),
      deletePermissionGroupMembership: vi
        .fn()
        .mockReturnValue(of({ deleted: true, id: 'membership-1' })),
      syncKeycloakPermissionGrants: vi
        .fn()
        .mockReturnValue(of({ queued: true })),
    };

    await TestBed.configureTestingModule({
      imports: [PermissionsComponent],
      providers: [
        provideRouter([]),
        provideNoopAnimations(),
        {
          provide: ApiService,
          useValue: apiService,
        },
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

    fixture = TestBed.createComponent(PermissionsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it('loads permission catalog and managed groups on init', () => {
    expect(apiService.getKeycloakPermissionCatalog).toHaveBeenCalled();
    expect(apiService.getPermissionGroupCatalog).toHaveBeenCalled();
    expect(apiService.getPermissionGroupRoleGrants).toHaveBeenCalledWith(
      PermissionGroupKey.Cacic,
    );
    expect(fixture.nativeElement.textContent).toContain('Permissões');
    expect(fixture.nativeElement.textContent).toContain('CACiC');
  });

  it('searches users and loads direct grants plus group memberships when selected', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const user = mockKeycloakPermissionUsers[0];

    component.searchForm.controls.query.setValue('alice');
    component.searchUsers();
    component.selectUser(user);
    fixture.detectChanges();

    expect(apiService.searchKeycloakPermissionUsers).toHaveBeenCalledWith(
      'alice',
    );
    expect(apiService.getKeycloakPermissionGrants).toHaveBeenCalledWith(
      user.id,
    );
    expect(apiService.getUserPermissionGroupMemberships).toHaveBeenCalledWith(
      user.id,
    );
    expect(fixture.nativeElement.textContent).toContain(user.displayName);
  });
});
