import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  DiscordManagedRoleDefinition,
  DiscordManagedRoleCategory,
  DiscordManagedRoleOverride,
  DiscordManagedRoleOverrideCreateRequest,
  KeycloakPermissionUser,
} from '@cacic/shared-types';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
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
import { forkJoin } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';
import { KeycloakPermissionsPersonPickerComponent } from '../keycloak-permissions/keycloak-permissions-person-picker.component';

const jsonObjectValidator: ValidatorFn = (
  control: AbstractControl,
): ValidationErrors | null => {
  const value = String(control.value ?? '').trim();

  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { jsonObject: true };
    }
  } catch {
    return { json: true };
  }

  return null;
};

@Component({
  selector: 'app-discord-managed-role-overrides',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatToolbarModule,
    MatTooltipModule,
    KeycloakPermissionsPersonPickerComponent,
  ],
  templateUrl: './discord-managed-role-overrides.component.html',
  styleUrl: './discord-managed-role-overrides.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordManagedRoleOverridesComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private formBuilder = inject(FormBuilder);
  private snackBar = inject(MatSnackBar);

  protected catalog = signal<DiscordManagedRoleDefinition[]>([]);
  protected overrides = signal<DiscordManagedRoleOverride[]>([]);
  protected users = signal<KeycloakPermissionUser[]>([]);
  protected selectedUser = signal<KeycloakPermissionUser | null>(null);
  protected editingOverride = signal<DiscordManagedRoleOverride | null>(null);
  protected loading = signal(true);
  protected searching = signal(false);
  protected saving = signal(false);
  protected deletingId = signal<string | null>(null);

  protected searchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });

  protected overrideForm = this.formBuilder.nonNullable.group({
    roleCategory: ['', Validators.required],
    reason: [''],
    dataJson: ['{}', jsonObjectValidator],
  });

  protected selectedRole = computed(() => {
    const category = this.overrideForm.controls.roleCategory.value;
    return (
      this.catalog().find((role) => role.category === category) ?? null
    );
  });

  protected isEditing = computed(() => this.editingOverride() !== null);

  ngOnInit(): void {
    this.loadPanel();
  }

  protected refresh(): void {
    this.loadPanel();
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
    const existingOverride =
      this.overrides().find((override) => override.userId === user.id) ?? null;

    this.selectedUser.set(user);
    this.editingOverride.set(existingOverride);
    this.patchForm(existingOverride);
  }

  protected selectOverride(override: DiscordManagedRoleOverride): void {
    this.editingOverride.set(override);
    this.selectedUser.set({
      id: override.userId,
      email: override.userEmail ?? '',
      displayName: override.userDisplayName ?? override.userId,
    });
    this.patchForm(override);
  }

  protected startNewOverride(): void {
    this.editingOverride.set(null);
    this.selectedUser.set(null);
    this.users.set([]);
    this.searchForm.reset();
    this.overrideForm.reset({
      roleCategory: this.catalog()[0]?.category ?? '',
      reason: '',
      dataJson: '{}',
    });
  }

  protected saveOverride(): void {
    const selectedUser = this.selectedUser();
    const editingOverride = this.editingOverride();
    if (!selectedUser && !editingOverride) {
      this.snackBar.open('Selecione uma pessoa antes de salvar.', 'Fechar', {
        duration: 4000,
      });
      return;
    }

    if (this.overrideForm.invalid) {
      this.overrideForm.markAllAsTouched();
      return;
    }

    const formValue = this.overrideForm.getRawValue();
    const data = this.parseDataJson(formValue.dataJson);
    const roleCategory = formValue.roleCategory as DiscordManagedRoleCategory;
    const request = {
      roleCategory,
      reason: formValue.reason.trim() || undefined,
      ...(data ? { data } : {}),
    } satisfies Omit<DiscordManagedRoleOverrideCreateRequest, 'userId'>;

    this.saving.set(true);
    const saveRequest = editingOverride
      ? this.apiService.updateDiscordManagedRoleOverride(
          editingOverride.id,
          request,
        )
      : this.createOverrideForSelectedUser(selectedUser, request);

    if (!saveRequest) {
      this.snackBar.open('Selecione uma pessoa antes de salvar.', 'Fechar', {
        duration: 4000,
      });
      this.saving.set(false);
      return;
    }

    saveRequest.subscribe({
      next: (override) => {
        this.upsertOverride(override);
        this.editingOverride.set(override);
        this.selectedUser.set({
          id: override.userId,
          email: override.userEmail ?? '',
          displayName: override.userDisplayName ?? override.userId,
        });
        this.patchForm(override);
        this.snackBar.open('Override de cargo salvo.', 'Fechar', {
          duration: 4000,
        });
        this.saving.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao salvar override de cargo.', 'Fechar', {
          duration: 5000,
        });
        this.saving.set(false);
      },
    });
  }

  private createOverrideForSelectedUser(
    selectedUser: KeycloakPermissionUser | null,
    request: Omit<DiscordManagedRoleOverrideCreateRequest, 'userId'>,
  ) {
    if (!selectedUser) {
      return null;
    }

    return this.apiService.createDiscordManagedRoleOverride({
      userId: selectedUser.id,
      ...request,
    } satisfies DiscordManagedRoleOverrideCreateRequest);
  }

  protected confirmDeleteOverride(
    override: DiscordManagedRoleOverride,
  ): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Remover override',
        message: `Remover override de ${
          override.userDisplayName || override.userEmail || override.userId
        }? A próxima sincronização volta a usar os critérios automáticos.`,
        confirmText: 'Remover',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.deleteOverride(override);
      }
    });
  }

  protected getOverrideSummary(override: DiscordManagedRoleOverride): string {
    return [
      override.userEmail,
      override.reason,
      Object.keys(override.data ?? {}).length
        ? `${Object.keys(override.data ?? {}).length} dado(s)`
        : null,
    ]
      .filter(Boolean)
      .join(' · ');
  }

  protected formatDate(value: string): string {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(value));
  }

  private loadPanel(): void {
    this.loading.set(true);
    forkJoin({
      catalog: this.apiService.getDiscordManagedRoleCatalog(),
      overrides: this.apiService.getDiscordManagedRoleOverrides(),
    }).subscribe({
      next: ({ catalog, overrides }) => {
        this.catalog.set(catalog);
        this.overrides.set(overrides);
        this.overrideForm.controls.roleCategory.setValue(
          this.editingOverride()?.roleCategory ?? catalog[0]?.category ?? '',
        );
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar overrides do Discord.', 'Fechar', {
          duration: 5000,
        });
        this.loading.set(false);
      },
    });
  }

  private patchForm(override: DiscordManagedRoleOverride | null): void {
    this.overrideForm.reset({
      roleCategory:
        override?.roleCategory ?? this.catalog()[0]?.category ?? '',
      reason: override?.reason ?? '',
      dataJson: JSON.stringify(override?.data ?? {}, null, 2),
    });
  }

  private parseDataJson(value: string): Record<string, unknown> | undefined {
    const normalized = value.trim();
    if (!normalized) {
      return undefined;
    }

    return JSON.parse(normalized) as Record<string, unknown>;
  }

  private upsertOverride(override: DiscordManagedRoleOverride): void {
    const nextOverrides = this.overrides().filter(
      (item) => item.id !== override.id && item.userId !== override.userId,
    );
    this.overrides.set([override, ...nextOverrides]);
  }

  private deleteOverride(override: DiscordManagedRoleOverride): void {
    this.deletingId.set(override.id);
    this.apiService.deleteDiscordManagedRoleOverride(override.id).subscribe({
      next: () => {
        this.overrides.set(
          this.overrides().filter((item) => item.id !== override.id),
        );
        if (this.editingOverride()?.id === override.id) {
          this.startNewOverride();
        }
        this.snackBar.open('Override removido.', 'Fechar', {
          duration: 4000,
        });
        this.deletingId.set(null);
      },
      error: () => {
        this.snackBar.open('Erro ao remover override.', 'Fechar', {
          duration: 5000,
        });
        this.deletingId.set(null);
      },
    });
  }
}
