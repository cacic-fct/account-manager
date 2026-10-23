import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  KeycloakPermissionDefinition,
  KeycloakPermissionLiveAccess,
  KeycloakPermissionGrant,
  KeycloakPermissionUser,
  PermissionGroupDefinition,
  PermissionGroupKey,
  PermissionGroupMembership,
  PermissionGroupRoleGrant,
} from '@cacic/shared-types';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { catchError, forkJoin, map, of } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';
import {
  activeGroupPermissions,
  availableDirectPermissions,
  formatMembership,
  formatValidity,
  getGroupLabel,
  getPermissionClientLabel,
  getPermissionLabel,
  getStatusLabel,
  groupPermissionsByClient,
} from './keycloak-permissions.view-model';
import { KeycloakPermissionsPersonPickerComponent } from './keycloak-permissions-person-picker.component';

type PermissionBatchApplyResult = {
  user: KeycloakPermissionUser;
  success: boolean;
};

@Component({
  selector: 'app-permissions',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatCheckboxModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    MatToolbarModule,
    MatTooltipModule,
    KeycloakPermissionsPersonPickerComponent,
  ],
  templateUrl: './keycloak-permissions.component.html',
  styleUrl: './keycloak-permissions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PermissionsComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);
  private userAccessRequestId = 0;

  protected catalog = signal<KeycloakPermissionDefinition[]>([]);
  protected groups = signal<PermissionGroupDefinition[]>([]);
  protected selectedGroupKey = signal<PermissionGroupKey | null>(null);
  protected groupRoleGrants = signal<PermissionGroupRoleGrant[]>([]);
  protected groupMemberships = signal<PermissionGroupMembership[]>([]);
  protected groupUsers = signal<KeycloakPermissionUser[]>([]);
  protected selectedGroupUsers = signal<KeycloakPermissionUser[]>([]);
  protected searchingGroupUsers = signal(false);
  protected deletingMembershipId = signal<string | null>(null);
  protected groupSearchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });
  protected selectedGroupPeopleLabel = computed(() => this.getSelectedPeopleLabel(this.selectedGroupUsers().length));

  protected users = signal<KeycloakPermissionUser[]>([]);
  protected selectedUser = signal<KeycloakPermissionUser | null>(null);
  protected selectedUsers = signal<KeycloakPermissionUser[]>([]);
  protected directGrants = signal<KeycloakPermissionGrant[]>([]);
  protected userMemberships = signal<PermissionGroupMembership[]>([]);
  protected liveAccess = signal<KeycloakPermissionLiveAccess | null>(null);
  protected liveAccessFailed = signal(false);
  protected loadingCatalog = signal(true);
  protected loadingGroup = signal(false);
  protected searching = signal(false);
  protected loadingUserAccess = signal(false);
  protected savingGroupRoles = signal(false);
  protected savingMembership = signal(false);
  protected savingGrant = signal(false);
  protected syncing = signal(false);
  protected deletingId = signal<string | null>(null);

  protected searchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });

  protected groupRolesForm = this.formBuilder.nonNullable.group({
    permissions: [[] as string[]],
  });

  protected membershipForm = this.formBuilder.nonNullable.group({
    validFrom: [this.toDateTimeLocal(new Date()), Validators.required],
    validUntil: [{ value: '', disabled: true }],
    indefinite: [true],
  });

  protected directGrantForm = this.formBuilder.nonNullable.group({
    permissions: [[] as string[], Validators.required],
    validFrom: [''],
    validUntil: [{ value: '', disabled: true }],
    indefinite: [true],
  });

  protected catalogByClient = computed(() => groupPermissionsByClient(this.catalog()));

  protected selectedGroup = computed(() => {
    const selectedKey = this.selectedGroupKey();
    if (!selectedKey) {
      return null;
    }

    return this.groups().find((group) => group.key === selectedKey) ?? null;
  });

  protected selectedGroupPermissions = computed(() => activeGroupPermissions(this.groupRoleGrants()));

  protected batchApplyUsers = computed(() => {
    const users = this.selectedUsers();
    if (users.length > 0) {
      return users;
    }

    const user = this.selectedUser();
    return user ? [user] : [];
  });

  protected batchApplyUserCount = computed(() => this.batchApplyUsers().length);

  protected selectedPeopleLabel = computed(() => this.getSelectedPeopleLabel(this.batchApplyUserCount()));

  protected availableDirectPermissions = computed(() => {
    if (this.batchApplyUserCount() > 1) {
      return this.catalog();
    }

    return availableDirectPermissions(this.catalog(), this.directGrants());
  });

  protected availableDirectPermissionIds = computed(
    () => new Set(this.availableDirectPermissions().map((permission) => permission.permission)),
  );

  protected hasAvailableDirectPermissions = computed(() => this.availableDirectPermissions().length > 0);

  ngOnInit(): void {
    this.loadCatalog();
  }

  protected selectGroup(groupKey: PermissionGroupKey): void {
    if (this.selectedGroupKey() === groupKey) {
      return;
    }

    this.selectedGroupKey.set(groupKey);
    this.groupRoleGrants.set([]);
    this.groupMemberships.set([]);
    this.groupRolesForm.controls.permissions.setValue([]);
    this.loadGroup(groupKey);
  }

  protected searchUsers(target: 'groups' | 'people' = 'people'): void {
    const searchForm = target === 'groups' ? this.groupSearchForm : this.searchForm;
    const searching = target === 'groups' ? this.searchingGroupUsers : this.searching;
    const results = target === 'groups' ? this.groupUsers : this.users;
    const query = searchForm.controls.query.value.trim();
    if (searchForm.invalid || query.length < 2) {
      searchForm.markAllAsTouched();
      return;
    }

    searching.set(true);
    this.apiService.searchKeycloakPermissionUsers(query).subscribe({
      next: (users) => {
        results.set(users);
        searching.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao buscar pessoas no Keycloak.', 'Fechar', {
          duration: 5000,
        });
        searching.set(false);
      },
    });
  }

  protected toggleGroupUser(user: KeycloakPermissionUser): void {
    const selected = this.selectedGroupUsers().some((person) => person.id === user.id);
    if (selected) {
      this.removeGroupUser(user.id);
    } else {
      this.selectedGroupUsers.update((users) => [...users, user]);
    }
  }

  protected removeGroupUser(userId: string): void {
    this.selectedGroupUsers.update((users) => users.filter((user) => user.id !== userId));
  }

  protected setMembershipIndefinite(checked: boolean): void {
    this.updateOptionalEndDateControl(this.membershipForm.controls.validUntil, checked);
  }

  protected setDirectGrantIndefinite(checked: boolean): void {
    this.updateOptionalEndDateControl(this.directGrantForm.controls.validUntil, checked);
  }

  protected selectUser(user: KeycloakPermissionUser): void {
    this.selectedUsers.set([user]);
    this.loadSelectedUserAccess(user);
  }

  protected toggleBatchUser(user: KeycloakPermissionUser): void {
    const selectedUsers = this.selectedUsers();
    const userIsSelected = selectedUsers.some((selectedUser) => selectedUser.id === user.id);

    if (userIsSelected) {
      this.removeBatchUser(user.id);
      return;
    }

    this.selectedUsers.set([...selectedUsers, user]);
    this.loadSelectedUserAccess(user);
  }

  protected removeBatchUser(userId: string): void {
    const selectedUsers = this.selectedUsers().filter((user) => user.id !== userId);
    this.selectedUsers.set(selectedUsers);

    if (this.selectedUser()?.id !== userId) {
      return;
    }

    const nextUser = selectedUsers.at(-1);
    if (nextUser) {
      this.loadSelectedUserAccess(nextUser);
      return;
    }

    this.clearSelectedUserAccess();
  }

  private loadSelectedUserAccess(user: KeycloakPermissionUser): void {
    this.selectedUser.set(user);
    this.directGrants.set([]);
    this.userMemberships.set([]);
    this.liveAccess.set(null);
    this.liveAccessFailed.set(false);
    this.resetDirectGrantForm();
    this.loadUserAccess(user.id);
  }

  protected saveGroupRoles(): void {
    const group = this.selectedGroup();
    if (!group) {
      return;
    }

    const permissions = this.groupRolesForm.controls.permissions.value;
    const groupKey = group.key;
    this.savingGroupRoles.set(true);
    this.apiService.updatePermissionGroupRoleGrants(groupKey, { permissions }).subscribe({
      next: (grants) => {
        if (this.selectedGroupKey() !== groupKey) {
          this.savingGroupRoles.set(false);
          return;
        }

        this.groupRoleGrants.set(grants);
        this.groupRolesForm.controls.permissions.setValue(this.getSelectedGroupRolePermissions(groupKey, grants));
        this.snackBar.open('Permissões do grupo salvas.', 'Fechar', {
          duration: 4000,
        });
        this.savingGroupRoles.set(false);
      },
      error: () => {
        if (this.selectedGroupKey() !== groupKey) {
          this.savingGroupRoles.set(false);
          return;
        }

        this.snackBar.open('Erro ao salvar permissões do grupo.', 'Fechar', {
          duration: 5000,
        });
        this.savingGroupRoles.set(false);
      },
    });
  }

  protected saveMembership(): void {
    const group = this.selectedGroup();
    const users = this.selectedGroupUsers();
    if (!group || users.length === 0) {
      this.snackBar.open('Selecione um grupo e ao menos uma pessoa.', 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (this.membershipForm.invalid) {
      this.membershipForm.markAllAsTouched();
      return;
    }

    const value = this.membershipForm.getRawValue();
    const validUntil = value.indefinite ? null : this.toIsoOrNull(value.validUntil);
    if (!value.indefinite && !validUntil) {
      this.membershipForm.controls.validUntil.setErrors({ invalidDate: true });
      this.membershipForm.controls.validUntil.markAsTouched();
      this.snackBar.open('Informe o fim do vínculo ou marque como indefinido.', 'Fechar', {
        duration: 5000,
      });
      return;
    }

    this.savingMembership.set(true);
    const validFrom = this.toIsoOrNull(value.validFrom) ?? new Date().toISOString();
    forkJoin(
      users.map((user) =>
        this.apiService
          .createPermissionGroupMembership({
            userId: user.id,
            groupKey: group.key,
            validFrom,
            validUntil,
          })
          .pipe(
            map(() => ({ user, success: true }) satisfies PermissionBatchApplyResult),
            catchError(() => of({ user, success: false } satisfies PermissionBatchApplyResult)),
          ),
      ),
    ).subscribe((results) => {
      this.showBatchApplyResult(results, 'Pessoa vinculada ao grupo.', 'pessoa(s) vinculada(s) ao grupo');
      this.savingMembership.set(false);
      this.loadGroup(group.key);

      const selectedUser = this.selectedUser();
      if (selectedUser) {
        this.loadUserAccess(selectedUser.id);
      }
    });
  }

  protected createDirectGrant(): void {
    const users = this.batchApplyUsers();
    if (users.length === 0) {
      this.snackBar.open('Selecione ao menos uma pessoa.', 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (this.directGrantForm.invalid) {
      this.directGrantForm.markAllAsTouched();
      return;
    }

    const value = this.directGrantForm.getRawValue();
    const validUntil = value.indefinite ? null : this.toIsoOrNull(value.validUntil);
    if (!value.indefinite && !validUntil) {
      this.directGrantForm.controls.validUntil.setErrors({ invalidDate: true });
      this.directGrantForm.controls.validUntil.markAsTouched();
      this.snackBar.open('Informe o fim da permissão ou marque como indefinida.', 'Fechar', {
        duration: 5000,
      });
      return;
    }

    this.savingGrant.set(true);
    forkJoin(
      users.flatMap((user) =>
        value.permissions.map((permission) =>
          this.apiService
            .createKeycloakPermissionGrant({
              userId: user.id,
              permission,
              validFrom: this.toIsoOrNull(value.validFrom),
              validUntil,
            })
            .pipe(
              map(() => ({ user, success: true }) satisfies PermissionBatchApplyResult),
              catchError(() => of({ user, success: false } satisfies PermissionBatchApplyResult)),
            ),
        ),
      ),
    ).subscribe((results) => {
      this.showBatchApplyResult(results, 'Permissão concedida.', 'permissão(ões) concedida(s)');
      this.savingGrant.set(false);
      this.resetDirectGrantForm();

      const selectedUser = this.selectedUser();
      if (selectedUser) {
        this.loadUserAccess(selectedUser.id);
      }
    });
  }

  protected confirmDeleteGrant(grant: KeycloakPermissionGrant): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Remover permissão',
        message: `Remover ${this.getPermissionLabel(grant.permission)} de ${grant.userDisplayName || grant.userEmail || grant.userId}?`,
        confirmText: 'Remover',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.deleteGrant(grant.id);
      }
    });
  }

  protected confirmDeleteMembership(membership: PermissionGroupMembership): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Remover vínculo',
        message: `Remover ${membership.userDisplayName || membership.userEmail || membership.userId} de ${this.getGroupLabel(membership.groupKey)}?`,
        confirmText: 'Remover',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.deleteMembership(membership.id);
      }
    });
  }

  protected syncGrants(): void {
    this.syncing.set(true);
    this.apiService.syncKeycloakPermissionGrants().subscribe({
      next: () => {
        this.snackBar.open('Sincronização agendada.', 'Fechar', {
          duration: 4000,
        });
        this.syncing.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao agendar sincronização.', 'Fechar', {
          duration: 5000,
        });
        this.syncing.set(false);
      },
    });
  }

  protected refreshCurrent(): void {
    this.loadCatalog();
    const user = this.selectedUser();
    if (user) {
      this.loadUserAccess(user.id);
    }
  }

  protected isGroupPermissionSelected(permission: string): boolean {
    return this.selectedGroupPermissions().has(permission);
  }

  protected getPermissionLabel(permission: string): string {
    return getPermissionLabel(this.catalog(), permission);
  }

  protected getPermissionClientLabel(permission: string): string {
    return getPermissionClientLabel(this.catalog(), permission);
  }

  protected getGroupLabel(groupKey: string): string {
    return getGroupLabel(this.groups(), groupKey);
  }

  protected getStatusLabel(status: string): string {
    return getStatusLabel(status);
  }

  protected formatValidity(item: { validFrom?: string | null; validUntil?: string | null }): string {
    return formatValidity(item);
  }

  protected formatMembership(membership: PermissionGroupMembership): string {
    return formatMembership(membership);
  }

  private loadCatalog(): void {
    this.loadingCatalog.set(this.catalog().length === 0);
    forkJoin({
      catalog: this.apiService.getKeycloakPermissionCatalog(),
      groups: this.apiService.getPermissionGroupCatalog(),
    }).subscribe({
      next: ({ catalog, groups }) => {
        this.catalog.set(catalog);
        this.groups.set(groups);
        this.loadingCatalog.set(false);
        const group = groups.find((candidate) => candidate.key === this.selectedGroupKey()) ?? groups[0];
        if (group) {
          this.selectedGroupKey.set(group.key);
          this.loadGroup(group.key);
        }
      },
      error: () => {
        this.snackBar.open('Erro ao carregar catálogo de permissões.', 'Fechar', {
          duration: 5000,
        });
        this.loadingCatalog.set(false);
      },
    });
  }

  private loadGroup(groupKey: PermissionGroupKey): void {
    this.loadingGroup.set(true);
    forkJoin({
      roleGrants: this.apiService.getPermissionGroupRoleGrants(groupKey),
      memberships: this.apiService.getPermissionGroupMemberships(groupKey),
    }).subscribe({
      next: ({ roleGrants, memberships }) => {
        if (this.selectedGroupKey() !== groupKey) {
          return;
        }

        this.groupRoleGrants.set(roleGrants);
        this.groupMemberships.set(memberships);
        this.groupRolesForm.controls.permissions.setValue(this.getSelectedGroupRolePermissions(groupKey, roleGrants));
        this.loadingGroup.set(false);
      },
      error: () => {
        if (this.selectedGroupKey() !== groupKey) {
          return;
        }

        this.snackBar.open('Erro ao carregar grupo.', 'Fechar', {
          duration: 5000,
        });
        this.loadingGroup.set(false);
      },
    });
  }

  private loadUserAccess(userId: string): void {
    const requestId = ++this.userAccessRequestId;
    this.loadingUserAccess.set(true);
    this.liveAccess.set(null);
    this.liveAccessFailed.set(false);
    forkJoin({
      liveAccess: this.apiService.getKeycloakPermissionLiveAccess(userId).pipe(catchError(() => of(null))),
      grants: this.apiService.getKeycloakPermissionGrants(userId),
      memberships: this.apiService.getUserPermissionGroupMemberships(userId),
    }).subscribe({
      next: ({ grants, memberships, liveAccess }) => {
        if (this.selectedUser()?.id !== userId || requestId !== this.userAccessRequestId) {
          return;
        }

        this.liveAccess.set(liveAccess);
        this.liveAccessFailed.set(liveAccess === null);
        this.directGrants.set(grants);
        this.userMemberships.set(memberships);
        this.loadingUserAccess.set(false);
      },
      error: () => {
        if (this.selectedUser()?.id !== userId || requestId !== this.userAccessRequestId) {
          return;
        }

        this.snackBar.open('Erro ao carregar permissões da pessoa.', 'Fechar', {
          duration: 5000,
        });
        this.loadingUserAccess.set(false);
      },
    });
  }

  private clearSelectedUserAccess(): void {
    this.userAccessRequestId++;
    this.selectedUser.set(null);
    this.directGrants.set([]);
    this.userMemberships.set([]);
    this.liveAccess.set(null);
    this.liveAccessFailed.set(false);
    this.resetDirectGrantForm();
    this.loadingUserAccess.set(false);
  }

  private showBatchApplyResult(
    results: PermissionBatchApplyResult[],
    singleSuccessMessage: string,
    batchSuccessLabel: string,
  ): void {
    const successCount = results.filter((result) => result.success).length;
    const failedCount = results.length - successCount;

    if (results.length === 1 && successCount === 1) {
      this.snackBar.open(singleSuccessMessage, 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (failedCount === 0) {
      this.snackBar.open(`${successCount} ${batchSuccessLabel}.`, 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (successCount === 0) {
      this.snackBar.open('Não foi possível aplicar a permissão para as pessoas selecionadas.', 'Fechar', {
        duration: 6000,
      });
      return;
    }

    this.snackBar.open(`${successCount} aplicada(s), ${failedCount} falha(s). Revise vínculos duplicados.`, 'Fechar', {
      duration: 6000,
    });
  }

  private deleteGrant(grantId: string): void {
    this.deletingId.set(grantId);
    this.apiService.deleteKeycloakPermissionGrant(grantId).subscribe({
      next: () => {
        const user = this.selectedUser();
        if (user) {
          this.loadUserAccess(user.id);
        }
        this.deletingId.set(null);
      },
      error: () => {
        this.snackBar.open('Erro ao remover permissão.', 'Fechar', {
          duration: 5000,
        });
        this.deletingId.set(null);
      },
    });
  }

  private deleteMembership(membershipId: string): void {
    this.deletingMembershipId.set(membershipId);
    this.apiService.deletePermissionGroupMembership(membershipId).subscribe({
      next: () => {
        const group = this.selectedGroup();
        if (group) {
          this.loadGroup(group.key);
        }
        const user = this.selectedUser();
        if (user) {
          this.loadUserAccess(user.id);
        }
        this.deletingMembershipId.set(null);
      },
      error: () => {
        this.snackBar.open('Erro ao remover vínculo.', 'Fechar', {
          duration: 5000,
        });
        this.deletingMembershipId.set(null);
      },
    });
  }

  private getSelectedPeopleLabel(count: number): string {
    if (count === 0) {
      return 'Nenhuma pessoa selecionada';
    }

    return count === 1 ? '1 pessoa selecionada' : `${count} pessoas selecionadas`;
  }

  private resetDirectGrantForm(): void {
    this.directGrantForm.reset({
      permissions: [],
      validFrom: '',
      validUntil: '',
      indefinite: true,
    });
    this.updateOptionalEndDateControl(this.directGrantForm.controls.validUntil, true);
  }

  private getSelectedGroupRolePermissions(
    groupKey: PermissionGroupKey,
    roleGrants: PermissionGroupRoleGrant[],
  ): string[] {
    return roleGrants
      .filter((grant) => grant.groupKey === groupKey && grant.status !== 'expired')
      .map((grant) => grant.permission);
  }

  private updateOptionalEndDateControl(control: FormControl<string>, indefinite: boolean): void {
    if (indefinite) {
      control.reset('');
      control.clearValidators();
      control.disable();
    } else {
      control.enable();
      control.setValidators(Validators.required);
    }

    control.updateValueAndValidity();
  }

  private toDateTimeLocal(date: Date): string {
    const pad = (value: number) => String(value).padStart(2, '0');
    const year = date.getFullYear();
    const month = pad(date.getMonth() + 1);
    const day = pad(date.getDate());
    const hours = pad(date.getHours());
    const minutes = pad(date.getMinutes());
    return `${year}-${month}-${day}T${hours}:${minutes}`;
  }

  private toIsoOrNull(value: string | null | undefined): string | null {
    if (!value) {
      return null;
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return null;
    }

    return date.toISOString();
  }
}

export { PermissionsComponent as KeycloakPermissionsComponent };
