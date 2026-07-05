import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountManagerPermission, PermissionGroupKey, buildKeycloakPermissionId } from '@cacic/shared-types';
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
  directGrantForm: { controls: { permission: { setValue: (value: string) => void } } };
  groupRolesForm: { controls: { permissions: { value: string[] } } };
  searchForm: { controls: { query: { setValue: (value: string) => void } } };
  batchApplyUserCount: () => number;
  createDirectGrant: () => void;
  saveGroupRoles: () => void;
  saveMembership: () => void;
  searchUsers: () => void;
  selectGroup: (groupKey: PermissionGroupKey) => void;
  selectUser: (user: (typeof mockKeycloakPermissionUsers)[number]) => void;
  toggleBatchUser: (user: (typeof mockKeycloakPermissionUsers)[number]) => void;
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
      getKeycloakPermissionCatalog: vi.fn().mockReturnValue(of(mockKeycloakPermissionCatalog)),
      getPermissionGroupCatalog: vi.fn().mockReturnValue(of(mockPermissionGroupCatalog)),
      getPermissionGroupRoleGrants: vi.fn((groupKey: PermissionGroupKey) =>
        of(mockPermissionGroupRoleGrants.filter((grant) => grant.groupKey === groupKey)),
      ),
      getPermissionGroupMemberships: vi.fn((groupKey: PermissionGroupKey) =>
        of(mockStudentEntityMemberships.filter((membership) => membership.groupKey === groupKey)),
      ),
      searchKeycloakPermissionUsers: vi.fn().mockReturnValue(of(mockKeycloakPermissionUsers.slice(0, 2))),
      getKeycloakPermissionGrants: vi.fn().mockReturnValue(of([mockDirectKeycloakPermissionGrant])),
      getUserPermissionGroupMemberships: vi.fn((userId: string) =>
        of(mockStudentEntityMemberships.filter((membership) => membership.userId === userId)),
      ),
      updatePermissionGroupRoleGrants: vi.fn().mockReturnValue(of([])),
      createPermissionGroupMembership: vi.fn().mockReturnValue(of(null)),
      createKeycloakPermissionGrant: vi.fn().mockReturnValue(of(mockDirectKeycloakPermissionGrant)),
      deleteKeycloakPermissionGrant: vi.fn().mockReturnValue(of({ deleted: true, id: 'grant-1' })),
      deletePermissionGroupMembership: vi.fn().mockReturnValue(of({ deleted: true, id: 'membership-1' })),
      syncKeycloakPermissionGrants: vi.fn().mockReturnValue(of({ queued: true })),
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
    expect(apiService.getPermissionGroupRoleGrants).toHaveBeenCalledWith(PermissionGroupKey.Cacic);
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

    expect(apiService.searchKeycloakPermissionUsers).toHaveBeenCalledWith('alice');
    expect(apiService.getKeycloakPermissionGrants).toHaveBeenCalledWith(user.id);
    expect(apiService.getUserPermissionGroupMemberships).toHaveBeenCalledWith(user.id);
    expect(fixture.nativeElement.textContent).toContain(user.displayName);
  });

  it('creates group memberships for every selected person', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const users = mockKeycloakPermissionUsers.slice(0, 2);

    users.forEach((user) => component.toggleBatchUser(user));
    component.saveMembership();

    expect(component.batchApplyUserCount()).toBe(2);
    expect(apiService.createPermissionGroupMembership).toHaveBeenCalledTimes(2);
    expect(apiService.createPermissionGroupMembership).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        userId: users[0].id,
        groupKey: PermissionGroupKey.Cacic,
        validUntil: null,
      }),
    );
    expect(apiService.createPermissionGroupMembership).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        userId: users[1].id,
        groupKey: PermissionGroupKey.Cacic,
        validUntil: null,
      }),
    );
  });

  it('creates direct grants for every selected person', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const users = mockKeycloakPermissionUsers.slice(0, 2);
    const permission = mockKeycloakPermissionCatalog[0].permission;

    users.forEach((user) => component.toggleBatchUser(user));
    component.directGrantForm.controls.permission.setValue(permission);
    component.createDirectGrant();

    expect(apiService.createKeycloakPermissionGrant).toHaveBeenCalledTimes(2);
    expect(apiService.createKeycloakPermissionGrant).toHaveBeenNthCalledWith(1, {
      userId: users[0].id,
      permission,
      validFrom: null,
      validUntil: null,
    });
    expect(apiService.createKeycloakPermissionGrant).toHaveBeenNthCalledWith(2, {
      userId: users[1].id,
      permission,
      validFrom: null,
      validUntil: null,
    });
  });

  it('does not autoselect Keycloak template permissions for groups managed by CACiC', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const templatePermission = buildKeycloakPermissionId('cacic-event-manager', 'events#read');
    const ejcompGrants = [
      {
        id: 'keycloak:EJCOMP:cacic-event-manager:events#read',
        groupKey: PermissionGroupKey.Ejcomp,
        clientId: 'cacic-event-manager',
        roleName: 'events#read',
        permission: templatePermission,
        source: 'keycloak' as const,
        validFrom: null,
        validUntil: null,
        status: 'active' as const,
      },
      {
        id: 'group-grant-ejcomp-1',
        groupKey: PermissionGroupKey.Ejcomp,
        clientId: 'cacic-account-manager',
        roleName: 'permission-grant#read',
        permission: AccountManagerPermission.PermissionGrantRead,
        source: 'database' as const,
        validFrom: null,
        validUntil: null,
        status: 'active' as const,
      },
    ];

    apiService.getPermissionGroupRoleGrants.mockImplementation((groupKey: PermissionGroupKey) => {
      if (groupKey === PermissionGroupKey.Ejcomp) {
        return of(ejcompGrants);
      }

      return of(mockPermissionGroupRoleGrants.filter((grant) => grant.groupKey === groupKey));
    });
    apiService.updatePermissionGroupRoleGrants.mockReturnValue(of(ejcompGrants));

    component.selectGroup(PermissionGroupKey.Ejcomp);

    expect(component.groupRolesForm.controls.permissions.value).toEqual([AccountManagerPermission.PermissionGrantRead]);

    component.saveGroupRoles();

    expect(apiService.updatePermissionGroupRoleGrants).toHaveBeenCalledWith(PermissionGroupKey.Ejcomp, {
      permissions: [AccountManagerPermission.PermissionGrantRead],
    });
    expect(component.groupRolesForm.controls.permissions.value).toEqual([AccountManagerPermission.PermissionGrantRead]);
  });
});
