import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, Subject, throwError } from 'rxjs';
import { By } from '@angular/platform-browser';
import { MatSelect } from '@angular/material/select';
import { MatTabGroup } from '@angular/material/tabs';
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
import {
  KeycloakPermissionsPersonPickerComponent,
  PermissionPersonSearchForm,
} from './keycloak-permissions-person-picker.component';

type PermissionsComponentHarness = PermissionsComponent & {
  directGrantForm: { controls: { permissions: { value: string[]; setValue: (value: string[]) => void } } };
  groupRolesForm: { controls: { permissions: { value: string[] } } };
  searchForm: { controls: { query: { setValue: (value: string) => void } } };
  groupSearchForm: PermissionPersonSearchForm;
  groupUsers: () => typeof mockKeycloakPermissionUsers;
  selectedGroupUsers: () => typeof mockKeycloakPermissionUsers;
  users: () => typeof mockKeycloakPermissionUsers;
  selectedUsers: () => typeof mockKeycloakPermissionUsers;
  searching: () => boolean;
  searchingGroupUsers: () => boolean;
  toggleGroupUser: (user: (typeof mockKeycloakPermissionUsers)[number]) => void;
  removeGroupUser: (userId: string) => void;
  batchApplyUserCount: () => number;
  createDirectGrant: () => void;
  saveGroupRoles: () => void;
  refreshCurrent: () => void;
  saveMembership: () => void;
  searchUsers: (target?: 'groups' | 'people') => void;
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
    getKeycloakPermissionLiveAccess: ReturnType<typeof vi.fn>;
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
      getKeycloakPermissionLiveAccess: vi.fn().mockReturnValue(
        of({
          permissions: [AccountManagerPermission.StudentVerificationReview],
          groupKeys: [PermissionGroupKey.Cacic],
        }),
      ),
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

    users.forEach((user) => component.toggleGroupUser(user));
    component.saveMembership();

    expect(component.selectedGroupUsers()).toEqual(users);
    expect(component.batchApplyUserCount()).toBe(0);
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
    component.directGrantForm.controls.permissions.setValue([permission]);
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

  it('creates every selected permission for every selected person and clears the selection', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const users = mockKeycloakPermissionUsers.slice(0, 2);
    const permissions = mockKeycloakPermissionCatalog.slice(0, 2).map((entry) => entry.permission);

    users.forEach((user) => component.toggleBatchUser(user));
    component.directGrantForm.controls.permissions.setValue(permissions);
    component.createDirectGrant();

    expect(apiService.createKeycloakPermissionGrant).toHaveBeenCalledTimes(4);
    for (const user of users) {
      for (const permission of permissions) {
        expect(apiService.createKeycloakPermissionGrant).toHaveBeenCalledWith({
          userId: user.id,
          permission,
          validFrom: null,
          validUntil: null,
        });
      }
    }
    expect(component.directGrantForm.controls.permissions.value).toEqual([]);
  });

  it('renders the direct permission field as a multi-select', async () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    component.toggleBatchUser(mockKeycloakPermissionUsers[0]);
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const select = fixture.debugElement.query(By.css('.direct-grant-form mat-select')).componentInstance as MatSelect;
    expect(select.multiple).toBe(true);
  });

  it('requires at least one permission before granting access', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    component.toggleBatchUser(mockKeycloakPermissionUsers[0]);
    component.directGrantForm.controls.permissions.setValue([]);
    component.createDirectGrant();

    expect(apiService.createKeycloakPermissionGrant).not.toHaveBeenCalled();
  });

  it('reports partial failures across selected permissions and finishes the batch', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    apiService.createKeycloakPermissionGrant.mockReturnValueOnce(throwError(() => new Error('Failed')));
    component.toggleBatchUser(mockKeycloakPermissionUsers[0]);
    component.directGrantForm.controls.permissions.setValue(
      mockKeycloakPermissionCatalog.slice(0, 2).map((entry) => entry.permission),
    );
    component.createDirectGrant();

    expect(apiService.createKeycloakPermissionGrant).toHaveBeenCalledTimes(2);
    expect(TestBed.inject(MatSnackBar).open).toHaveBeenCalledWith(
      '1 alteração foi confirmada. 1 alteração ainda está sem confirmação. Confira o estado atualizado de cada pessoa antes de tentar novamente.',
      'Fechar',
      { duration: 10000 },
    );
    expect(apiService.getKeycloakPermissionGrants).toHaveBeenCalledWith(mockKeycloakPermissionUsers[0].id);
    expect(component.directGrantForm.controls.permissions.value).toEqual(
      mockKeycloakPermissionCatalog.slice(0, 2).map((entry) => entry.permission),
    );
  });

  it('keeps group selection separate from direct grants and their draft form', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const groupUser = mockKeycloakPermissionUsers[0];
    const directUser = mockKeycloakPermissionUsers[1];
    component.toggleGroupUser(groupUser);
    expect(apiService.getKeycloakPermissionGrants).not.toHaveBeenCalled();
    expect(component.selectedUsers()).toEqual([]);

    component.toggleBatchUser(directUser);
    const permission = mockKeycloakPermissionCatalog[0].permission;
    component.directGrantForm.controls.permissions.setValue([permission]);
    component.toggleGroupUser(directUser);
    component.removeGroupUser(groupUser.id);
    component.createDirectGrant();

    expect(component.selectedGroupUsers()).toEqual([directUser]);
    expect(component.selectedUsers()).toEqual([directUser]);
    expect(apiService.createKeycloakPermissionGrant).toHaveBeenCalledExactlyOnceWith({
      userId: directUser.id,
      permission,
      validFrom: null,
      validUntil: null,
    });
  });

  it('renders each tab with its own picker state after switching back and forth', async () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    const groupUser = mockKeycloakPermissionUsers[0];
    const directUser = mockKeycloakPermissionUsers[1];
    component.groupSearchForm.controls.query.setValue('group search');
    component.toggleGroupUser(groupUser);

    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const peoplePicker = fixture.debugElement
      .queryAll(By.directive(KeycloakPermissionsPersonPickerComponent))
      .map((element) => element.componentInstance as KeycloakPermissionsPersonPickerComponent)
      .find((picker) => picker.ariaLabel() === 'Selecionar pessoa para permissão direta');
    expect(peoplePicker?.searchForm().controls.query.value).toBe('');
    expect(peoplePicker?.selectedUsers()).toEqual([]);
    component.searchForm.controls.query.setValue('direct search');
    component.toggleBatchUser(directUser);

    tabs.selectedIndex = 0;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const groupPicker = fixture.debugElement
      .queryAll(By.directive(KeycloakPermissionsPersonPickerComponent))
      .map((element) => element.componentInstance as KeycloakPermissionsPersonPickerComponent)
      .find((picker) => picker.ariaLabel() === 'Selecionar pessoa para o vínculo');
    expect(groupPicker?.searchForm().controls.query.value).toBe('group search');
    expect(groupPicker?.selectedUsers()).toEqual([groupUser]);
    expect(component.searchForm.controls.query.value).toBe('direct search');
    expect(component.selectedUsers()).toEqual([directUser]);
  });

  it('keeps pending search results, form state and loading flags within their own tab', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const groupResponse = new Subject<typeof mockKeycloakPermissionUsers>();
    const peopleResponse = new Subject<typeof mockKeycloakPermissionUsers>();
    apiService.searchKeycloakPermissionUsers.mockReturnValueOnce(groupResponse).mockReturnValueOnce(peopleResponse);

    component.groupSearchForm.controls.query.setValue('group search');
    component.searchUsers('groups');
    expect(component.searchingGroupUsers()).toBe(true);
    expect(component.searching()).toBe(false);
    component.searchForm.controls.query.setValue('direct search');
    component.searchUsers();

    peopleResponse.next([mockKeycloakPermissionUsers[1]]);
    expect(component.searching()).toBe(false);
    expect(component.searchingGroupUsers()).toBe(true);
    expect(component.groupUsers()).toEqual([]);
    groupResponse.next([mockKeycloakPermissionUsers[0]]);
    expect(component.groupUsers()).toEqual([mockKeycloakPermissionUsers[0]]);
    expect(component.users()).toEqual([mockKeycloakPermissionUsers[1]]);
    expect(component.groupSearchForm.controls.query.value).toBe('group search');
    expect(component.searchForm.controls.query.value).toBe('direct search');
    expect(component.searchingGroupUsers()).toBe(false);
    groupResponse.complete();
    peopleResponse.complete();
  });

  it('preserves existing Keycloak roles when saving groups managed by CACiC', () => {
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

    expect(component.groupRolesForm.controls.permissions.value).toEqual([
      templatePermission,
      AccountManagerPermission.PermissionGrantRead,
    ]);

    component.saveGroupRoles();

    expect(apiService.updatePermissionGroupRoleGrants).toHaveBeenCalledWith(PermissionGroupKey.Ejcomp, {
      permissions: [templatePermission, AccountManagerPermission.PermissionGrantRead],
    });
    expect(component.groupRolesForm.controls.permissions.value).toEqual([
      templatePermission,
      AccountManagerPermission.PermissionGrantRead,
    ]);
  });
  it('shows live permissions and managed groups without requiring local grants', async () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    apiService.getKeycloakPermissionGrants.mockReturnValue(of([]));
    apiService.getUserPermissionGroupMemberships.mockReturnValue(of([]));
    component.selectUser(mockKeycloakPermissionUsers[0]);
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const text = fixture.nativeElement.textContent as string;
    expect(apiService.getKeycloakPermissionLiveAccess).toHaveBeenCalledWith(mockKeycloakPermissionUsers[0].id);
    expect(text).toContain('Acesso atual no Keycloak');
    expect(text).toContain('CACiC');
    expect(text).toContain('Revisar validações estudantis');
  });

  it('shows a retry state when live access cannot be read', async () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    apiService.getKeycloakPermissionLiveAccess.mockReturnValue(throwError(() => new Error('Unavailable')));
    component.selectUser(mockKeycloakPermissionUsers[0]);
    const tabs = fixture.debugElement.query(By.directive(MatTabGroup)).componentInstance as MatTabGroup;
    tabs.selectedIndex = 1;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Não foi possível consultar o acesso atual no Keycloak.');
    expect(fixture.nativeElement.textContent).not.toContain('Nenhuma permissão nos sistemas gerenciados.');
  });

  it('refreshes catalogs and live access while preserving the selected group', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    component.selectGroup(PermissionGroupKey.Ejcomp);
    component.selectUser(mockKeycloakPermissionUsers[0]);
    component.refreshCurrent();
    expect(apiService.getKeycloakPermissionCatalog).toHaveBeenCalledTimes(2);
    expect(apiService.getPermissionGroupCatalog).toHaveBeenCalledTimes(2);
    expect(apiService.getPermissionGroupRoleGrants).toHaveBeenLastCalledWith(PermissionGroupKey.Ejcomp);
    expect(apiService.getKeycloakPermissionLiveAccess).toHaveBeenCalledTimes(2);
  });

  it('ignores live access responses for previously selected people', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const pending = new Subject<{ permissions: string[]; groupKeys: PermissionGroupKey[] }>();
    apiService.getKeycloakPermissionLiveAccess.mockReturnValueOnce(pending);
    component.selectUser(mockKeycloakPermissionUsers[0]);
    component.selectUser(mockKeycloakPermissionUsers[1]);
    pending.next({ permissions: ['cacic-event-manager:stale-permission'], groupKeys: [] });
    pending.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('stale-permission');
  });
  it('ignores stale access responses after refreshing the same person', () => {
    const component = fixture.componentInstance as PermissionsComponentHarness;
    const pending = new Subject<{ permissions: string[]; groupKeys: PermissionGroupKey[] }>();
    apiService.getKeycloakPermissionLiveAccess.mockReturnValueOnce(pending);
    component.selectUser(mockKeycloakPermissionUsers[0]);
    component.refreshCurrent();
    pending.next({ permissions: ['cacic-event-manager:stale-permission'], groupKeys: [] });
    pending.complete();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).not.toContain('stale-permission');
  });
});
