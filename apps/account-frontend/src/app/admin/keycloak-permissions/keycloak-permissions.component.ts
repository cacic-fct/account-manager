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
  AssignableKeycloakPermission,
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionUser,
  StudentEntityDefinition,
  StudentEntityKey,
  StudentEntityMembership,
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
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ApiService } from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';

@Component({
  selector: 'app-keycloak-permissions',
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
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './keycloak-permissions.component.html',
  styleUrl: './keycloak-permissions.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KeycloakPermissionsComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  protected catalog = signal<KeycloakPermissionDefinition[]>([]);
  protected studentEntities = signal<StudentEntityDefinition[]>([]);
  protected selectedEntity = signal<StudentEntityKey>('CACIC');
  protected entityMemberships = signal<StudentEntityMembership[]>([]);
  protected users = signal<KeycloakPermissionUser[]>([]);
  protected selectedUser = signal<KeycloakPermissionUser | null>(null);
  protected grants = signal<KeycloakPermissionGrant[]>([]);
  protected memberships = signal<StudentEntityMembership[]>([]);
  protected loadingCatalog = signal(true);
  protected loadingMemberships = signal(false);
  protected searching = signal(false);
  protected loadingGrants = signal(false);
  protected saving = signal(false);
  protected savingMembership = signal(false);
  protected syncing = signal(false);
  protected deletingGrantId = signal<string | null>(null);
  protected deletingMembershipId = signal<string | null>(null);

  protected searchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });

  protected grantForm = this.formBuilder.nonNullable.group({
    permission: ['', Validators.required],
    validFrom: [''],
    validUntil: [''],
    indefinite: [true],
  });

  protected membershipForm = this.formBuilder.nonNullable.group({
    mandateStart: [this.toDateTimeLocal(new Date()), Validators.required],
    mandateEnd: [this.toDateTimeLocal(this.defaultMandateEnd()), Validators.required],
    permissions: [[] as string[]],
  });

  protected selectedEntityDefinition = computed(() =>
    this.studentEntities().find(
      (entity) => entity.key === this.selectedEntity(),
    ),
  );

  protected selectedEntityMembership = computed(() => {
    const user = this.selectedUser();
    if (!user) {
      return null;
    }

    return (
      this.memberships().find(
        (membership) =>
          membership.userId === user.id &&
          membership.entity === this.selectedEntity(),
      ) ?? null
    );
  });

  protected availablePermissions = computed(() => {
    const grantedPermissions = new Set(
      this.grants().map((grant) => grant.permission),
    );

    return this.catalog().filter(
      (definition) => !grantedPermissions.has(definition.permission),
    );
  });

  ngOnInit(): void {
    this.loadCatalog();
  }

  protected selectEntity(entity: StudentEntityKey): void {
    this.selectedEntity.set(entity);
    this.syncMembershipForm();
    this.loadEntityMemberships(entity);
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
        this.snackBar.open('Erro ao buscar usuários no Keycloak.', 'Fechar', {
          duration: 5000,
        });
        this.searching.set(false);
      },
    });
  }

  protected selectUser(user: KeycloakPermissionUser): void {
    this.selectedUser.set(user);
    this.grants.set([]);
    this.memberships.set([]);
    this.resetGrantForm();
    this.resetMembershipForm();
    this.loadGrants(user.id);
    this.loadUserMemberships(user.id);
  }

  protected saveMembership(): void {
    const user = this.selectedUser();
    if (!user) {
      return;
    }

    if (this.membershipForm.invalid) {
      this.membershipForm.markAllAsTouched();
      return;
    }

    const formValue = this.membershipForm.getRawValue();
    const payload = {
      mandateStart: this.toIsoOrNull(formValue.mandateStart) ?? '',
      mandateEnd: this.toIsoOrNull(formValue.mandateEnd) ?? '',
      permissions: formValue.permissions as AssignableKeycloakPermission[],
    };
    const currentMembership = this.selectedEntityMembership();
    const request = currentMembership
      ? this.apiService.updateStudentEntityMembership(
          currentMembership.id,
          payload,
        )
      : this.apiService.createStudentEntityMembership({
          userId: user.id,
          entity: this.selectedEntity(),
          ...payload,
        });

    this.savingMembership.set(true);
    request.subscribe({
      next: () => {
        this.snackBar.open('Mandato salvo.', 'Fechar', {
          duration: 4000,
        });
        this.savingMembership.set(false);
        this.loadUserMemberships(user.id);
        this.loadEntityMemberships(this.selectedEntity());
        this.loadGrants(user.id);
      },
      error: () => {
        this.snackBar.open('Erro ao salvar mandato.', 'Fechar', {
          duration: 5000,
        });
        this.savingMembership.set(false);
      },
    });
  }

  protected createGrant(): void {
    const user = this.selectedUser();
    if (!user) {
      return;
    }

    if (this.grantForm.invalid) {
      this.grantForm.markAllAsTouched();
      return;
    }

    const formValue = this.grantForm.getRawValue();
    const validUntil = formValue.indefinite
      ? null
      : this.toIsoOrNull(formValue.validUntil);
    if (!formValue.indefinite && !validUntil) {
      this.snackBar.open('Informe a data final ou marque como indefinida.', 'Fechar', {
        duration: 5000,
      });
      return;
    }

    this.saving.set(true);
    this.apiService
      .createKeycloakPermissionGrant({
        userId: user.id,
        permission: formValue.permission as AssignableKeycloakPermission,
        validFrom: this.toIsoOrNull(formValue.validFrom),
        validUntil,
      })
      .subscribe({
        next: () => {
          this.snackBar.open('Permissão concedida.', 'Fechar', {
            duration: 4000,
          });
          this.saving.set(false);
          this.resetGrantForm();
          this.loadGrants(user.id);
        },
        error: () => {
          this.snackBar.open('Erro ao conceder permissão.', 'Fechar', {
            duration: 5000,
          });
          this.saving.set(false);
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
    membership: StudentEntityMembership,
  ): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Encerrar mandato',
        message: `Encerrar o mandato de ${membership.userDisplayName || membership.userEmail || membership.userId} em ${this.getEntityLabel(membership.entity)}?`,
        confirmText: 'Encerrar',
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

  protected refreshGrants(): void {
    const user = this.selectedUser();
    if (user) {
      this.loadGrants(user.id);
      this.loadUserMemberships(user.id);
    }
    this.loadEntityMemberships(this.selectedEntity());
  }

  protected getPermissionLabel(permission: string): string {
    return (
      this.catalog().find((definition) => definition.permission === permission)
        ?.label ?? permission
    );
  }

  protected getApplicationLabel(application: string): string {
    const labels: Record<string, string> = {
      'account-manager': 'Account Manager',
      'event-manager': 'Event Manager',
      discord: 'Discord',
    };

    return labels[application] ?? application;
  }

  protected getEntityLabel(entity: string): string {
    return (
      this.studentEntities().find((definition) => definition.key === entity)
        ?.label ?? entity
    );
  }

  protected getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      active: 'Ativa',
      scheduled: 'Agendada',
      expired: 'Expirada',
    };

    return labels[status] ?? status;
  }

  protected formatDate(value: string | null | undefined): string {
    if (!value) {
      return '-';
    }

    return new Date(value).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected formatValidity(grant: KeycloakPermissionGrant): string {
    const from = grant.validFrom ? this.formatDate(grant.validFrom) : 'agora';
    const until = grant.validUntil
      ? this.formatDate(grant.validUntil)
      : 'indefinida';

    return `${from} até ${until}`;
  }

  protected formatMandate(membership: StudentEntityMembership): string {
    return `${this.formatDate(membership.mandateStart)} até ${this.formatDate(membership.mandateEnd)}`;
  }

  private loadCatalog(): void {
    this.loadingCatalog.set(true);
    this.apiService.getKeycloakPermissionCatalog().subscribe({
      next: (catalog) => {
        this.catalog.set(catalog);
        this.loadStudentEntities();
        this.loadingCatalog.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar catálogo de permissões.', 'Fechar', {
          duration: 5000,
        });
        this.loadingCatalog.set(false);
      },
    });
  }

  private loadStudentEntities(): void {
    this.apiService.getStudentEntityCatalog().subscribe({
      next: (entities) => {
        this.studentEntities.set(entities);
        const selectedEntity = entities.find(
          (entity) => entity.key === this.selectedEntity(),
        );
        if (!selectedEntity && entities[0]) {
          this.selectedEntity.set(entities[0].key);
        }
        this.loadEntityMemberships(this.selectedEntity());
      },
      error: () => {
        this.snackBar.open('Erro ao carregar entidades estudantis.', 'Fechar', {
          duration: 5000,
        });
      },
    });
  }

  private loadGrants(userId: string): void {
    this.loadingGrants.set(true);
    this.apiService.getKeycloakPermissionGrants(userId).subscribe({
      next: (grants) => {
        this.grants.set(grants);
        this.loadingGrants.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar permissões do usuário.', 'Fechar', {
          duration: 5000,
        });
        this.loadingGrants.set(false);
      },
    });
  }

  private loadUserMemberships(userId: string): void {
    this.apiService.getUserStudentEntityMemberships(userId).subscribe({
      next: (memberships) => {
        this.memberships.set(memberships);
        this.syncMembershipForm();
      },
      error: () => {
        this.snackBar.open('Erro ao carregar mandatos do usuário.', 'Fechar', {
          duration: 5000,
        });
      },
    });
  }

  private loadEntityMemberships(entity: StudentEntityKey): void {
    this.loadingMemberships.set(true);
    this.apiService.getStudentEntityMemberships(entity).subscribe({
      next: (memberships) => {
        this.entityMemberships.set(memberships);
        this.loadingMemberships.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar membros da entidade.', 'Fechar', {
          duration: 5000,
        });
        this.loadingMemberships.set(false);
      },
    });
  }

  private deleteGrant(grantId: string): void {
    const user = this.selectedUser();
    this.deletingGrantId.set(grantId);
    this.apiService.deleteKeycloakPermissionGrant(grantId).subscribe({
      next: () => {
        this.snackBar.open('Permissão removida.', 'Fechar', {
          duration: 4000,
        });
        this.deletingGrantId.set(null);
        if (user) {
          this.loadGrants(user.id);
        }
      },
      error: () => {
        this.snackBar.open('Erro ao remover permissão.', 'Fechar', {
          duration: 5000,
        });
        this.deletingGrantId.set(null);
      },
    });
  }

  private deleteMembership(membershipId: string): void {
    const user = this.selectedUser();
    this.deletingMembershipId.set(membershipId);
    this.apiService.deleteStudentEntityMembership(membershipId).subscribe({
      next: () => {
        this.snackBar.open('Mandato encerrado.', 'Fechar', {
          duration: 4000,
        });
        this.deletingMembershipId.set(null);
        this.loadEntityMemberships(this.selectedEntity());
        if (user) {
          this.loadUserMemberships(user.id);
          this.loadGrants(user.id);
        }
      },
      error: () => {
        this.snackBar.open('Erro ao encerrar mandato.', 'Fechar', {
          duration: 5000,
        });
        this.deletingMembershipId.set(null);
      },
    });
  }

  private resetGrantForm(): void {
    this.grantForm.reset({
      permission: '',
      validFrom: '',
      validUntil: '',
      indefinite: true,
    });
  }

  private resetMembershipForm(): void {
    this.membershipForm.reset({
      mandateStart: this.toDateTimeLocal(new Date()),
      mandateEnd: this.toDateTimeLocal(this.defaultMandateEnd()),
      permissions: [],
    });
  }

  private syncMembershipForm(): void {
    const membership = this.selectedEntityMembership();
    if (!membership) {
      this.resetMembershipForm();
      return;
    }

    this.membershipForm.reset({
      mandateStart: this.toDateTimeLocal(new Date(membership.mandateStart)),
      mandateEnd: this.toDateTimeLocal(new Date(membership.mandateEnd)),
      permissions: membership.permissionGrants.map((grant) => grant.permission),
    });
  }

  private toIsoOrNull(value: string): string | null {
    if (!value.trim()) {
      return null;
    }

    return new Date(value).toISOString();
  }

  private toDateTimeLocal(date: Date): string {
    const offsetMs = date.getTimezoneOffset() * 60 * 1000;
    return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
  }

  private defaultMandateEnd(): Date {
    const date = new Date();
    date.setFullYear(date.getFullYear() + 1);
    return date;
  }
}
