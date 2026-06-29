import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ReactiveFormsModule, Validators, FormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  KeycloakPermissionDefinition,
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
import { MatListModule } from '@angular/material/list';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { forkJoin } from 'rxjs';
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
    MatListModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatTabsModule,
    MatToolbarModule,
    MatTooltipModule,
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

  protected catalog = signal<KeycloakPermissionDefinition[]>([]);
  protected groups = signal<PermissionGroupDefinition[]>([]);
  protected selectedGroupKey = signal<PermissionGroupKey | null>(null);
  protected groupRoleGrants = signal<PermissionGroupRoleGrant[]>([]);
  protected groupMemberships = signal<PermissionGroupMembership[]>([]);
  protected users = signal<KeycloakPermissionUser[]>([]);
  protected selectedUser = signal<KeycloakPermissionUser | null>(null);
  protected directGrants = signal<KeycloakPermissionGrant[]>([]);
  protected userMemberships = signal<PermissionGroupMembership[]>([]);
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
    validUntil: [''],
    indefinite: [true],
  });

  protected directGrantForm = this.formBuilder.nonNullable.group({
    permission: ['', Validators.required],
    validFrom: [''],
    validUntil: [''],
    indefinite: [true],
  });

  protected catalogByClient = computed(() =>
    groupPermissionsByClient(this.catalog()),
  );

  protected selectedGroup = computed(() => {
    const selectedKey = this.selectedGroupKey();
    if (!selectedKey) {
      return null;
    }

    return (
      this.groups().find((group) => group.key === selectedKey) ?? null
    );
  });

  protected selectedGroupPermissions = computed(
    () => activeGroupPermissions(this.groupRoleGrants()),
  );

  protected availableDirectPermissions = computed(() =>
    availableDirectPermissions(this.catalog(), this.directGrants()),
  );

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

  protected searchUsers(): void {
    const query = this.searchForm.controls.query.value.trim();
    if (this.searchForm.invalid || query.length < 2) {
      this.searchForm.markAllAsTouched();
      return;
    }

    this.searching.set(true);
    this.apiService.searchKeycloakPermissionUsers(query).subscribe({
      next: (users) => {
        this.users.set(users);
        this.searching.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao buscar pessoas no Keycloak.', 'Fechar', {
          duration: 5000,
        });
        this.searching.set(false);
      },
    });
  }

  protected selectUser(user: KeycloakPermissionUser): void {
    this.selectedUser.set(user);
    this.directGrants.set([]);
    this.userMemberships.set([]);
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
    this.apiService
      .updatePermissionGroupRoleGrants(groupKey, { permissions })
      .subscribe({
        next: (grants) => {
          if (this.selectedGroupKey() !== groupKey) {
            this.savingGroupRoles.set(false);
            return;
          }

          this.groupRoleGrants.set(grants);
          this.groupRolesForm.controls.permissions.setValue(
            grants.map((grant) => grant.permission),
          );
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
    const user = this.selectedUser();
    if (!group || !user) {
      this.snackBar.open('Selecione um grupo e uma pessoa.', 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (this.membershipForm.invalid) {
      this.membershipForm.markAllAsTouched();
      return;
    }

    const value = this.membershipForm.getRawValue();
    const validUntil = value.indefinite
      ? null
      : this.toIsoOrNull(value.validUntil);
    if (!value.indefinite && !validUntil) {
      this.snackBar.open('Informe o fim do vínculo ou marque como indefinido.', 'Fechar', {
        duration: 5000,
      });
      return;
    }

    this.savingMembership.set(true);
    this.apiService
      .createPermissionGroupMembership({
        userId: user.id,
        groupKey: group.key,
        validFrom: this.toIsoOrNull(value.validFrom) ?? new Date().toISOString(),
        validUntil,
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Pessoa vinculada ao grupo.', 'Fechar', {
            duration: 4000,
          });
          this.savingMembership.set(false);
          this.loadGroup(group.key);
          this.loadUserAccess(user.id);
        },
        error: () => {
          this.snackBar.open('Erro ao criar vínculo.', 'Fechar', {
            duration: 5000,
          });
          this.savingMembership.set(false);
        },
      });
  }

  protected createDirectGrant(): void {
    const user = this.selectedUser();
    if (!user) {
      this.snackBar.open('Selecione uma pessoa.', 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (this.directGrantForm.invalid) {
      this.directGrantForm.markAllAsTouched();
      return;
    }

    const value = this.directGrantForm.getRawValue();
    const validUntil = value.indefinite
      ? null
      : this.toIsoOrNull(value.validUntil);
    if (!value.indefinite && !validUntil) {
      this.snackBar.open('Informe o fim da permissão ou marque como indefinida.', 'Fechar', {
        duration: 5000,
      });
      return;
    }

    this.savingGrant.set(true);
    this.apiService
      .createKeycloakPermissionGrant({
        userId: user.id,
        permission: value.permission,
        validFrom: this.toIsoOrNull(value.validFrom),
        validUntil,
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Permissão concedida.', 'Fechar', {
            duration: 4000,
          });
          this.savingGrant.set(false);
          this.resetDirectGrantForm();
          this.loadUserAccess(user.id);
        },
        error: () => {
          this.snackBar.open('Erro ao conceder permissão.', 'Fechar', {
            duration: 5000,
          });
          this.savingGrant.set(false);
        },
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

  protected confirmDeleteMembership(
    membership: PermissionGroupMembership,
  ): void {
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
    const group = this.selectedGroup();
    if (group) {
      this.loadGroup(group.key);
    }

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

  protected formatValidity(item: {
    validFrom?: string | null;
    validUntil?: string | null;
  }): string {
    return formatValidity(item);
  }

  protected formatMembership(membership: PermissionGroupMembership): string {
    return formatMembership(membership);
  }

  private loadCatalog(): void {
    this.loadingCatalog.set(true);
    forkJoin({
      catalog: this.apiService.getKeycloakPermissionCatalog(),
      groups: this.apiService.getPermissionGroupCatalog(),
    }).subscribe({
      next: ({ catalog, groups }) => {
        this.catalog.set(catalog);
        this.groups.set(groups);
        this.loadingCatalog.set(false);
        const firstGroup = groups[0];
        if (firstGroup) {
          this.selectedGroupKey.set(firstGroup.key);
          this.loadGroup(firstGroup.key);
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
        this.groupRolesForm.controls.permissions.setValue(
          roleGrants
            .filter((grant) => grant.status !== 'expired')
            .map((grant) => grant.permission),
        );
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
    this.loadingUserAccess.set(true);
    forkJoin({
      grants: this.apiService.getKeycloakPermissionGrants(userId),
      memberships: this.apiService.getUserPermissionGroupMemberships(userId),
    }).subscribe({
      next: ({ grants, memberships }) => {
        if (this.selectedUser()?.id !== userId) {
          return;
        }

        this.directGrants.set(grants);
        this.userMemberships.set(memberships);
        this.loadingUserAccess.set(false);
      },
      error: () => {
        if (this.selectedUser()?.id !== userId) {
          return;
        }

        this.snackBar.open('Erro ao carregar permissões da pessoa.', 'Fechar', {
          duration: 5000,
        });
        this.loadingUserAccess.set(false);
      },
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
    this.deletingId.set(membershipId);
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
        this.deletingId.set(null);
      },
      error: () => {
        this.snackBar.open('Erro ao remover vínculo.', 'Fechar', {
          duration: 5000,
        });
        this.deletingId.set(null);
      },
    });
  }

  private resetDirectGrantForm(): void {
    this.directGrantForm.reset({
      permission: '',
      validFrom: '',
      validUntil: '',
      indefinite: true,
    });
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
