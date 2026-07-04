import { Component, OnInit, OnDestroy, signal, inject, computed, ChangeDetectionStrategy } from '@angular/core';

import { ReactiveFormsModule, FormBuilder, FormGroup, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { HttpErrorResponse } from '@angular/common/http';
import { DiscordRoleOptionComponent } from '../../../../../shared/components/discord-role-option.component';
import { ApiService } from '../../../../../shared/services/api.service';
import type { DiscordRole, UserRoles, RoleSelectionResponse } from '@cacic/shared-types';

type RoleSelectionErrorAction = 'login' | 'link' | 'retry';

@Component({
  selector: 'app-discord-role-selection',
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatCheckboxModule,
    MatProgressSpinnerModule,
    MatDividerModule,
    DiscordRoleOptionComponent,
  ],
  templateUrl: './discord-role-selection.component.html',
  styleUrl: './discord-role-selection.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordRoleSelectionComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  private formBuilder = inject(FormBuilder);

  // Reactive Form
  roleForm: FormGroup = this.formBuilder.group({});

  // State signals
  isLoading = signal<boolean>(true);
  isSaving = signal<boolean>(false);
  availableRoles = signal<DiscordRole[]>([]);
  userRoles = signal<UserRoles | null>(null);
  errorMessage = signal<string>('');
  errorAction = signal<RoleSelectionErrorAction>('retry');
  updateErrorMessage = signal<string>('');
  successMessage = signal<string>('');
  initialSelectedIds = signal<Set<string>>(new Set());

  // Cooldown state
  cooldownEndTime = signal<number>(0);
  updateAttempts = signal<number>(0);
  remainingCooldown = signal<number>(0);
  private cooldownTimer: ReturnType<typeof setInterval> | null = null;

  // Form change tracking signal - will be updated manually after form setup
  formChangeSignal = signal<number>(0);

  // Convert form valueChanges to signal for reactive change detection
  formValue = computed(() => {
    // React to manual form change trigger
    this.formChangeSignal();
    return this.roleForm.value;
  });

  // Computed properties
  currentRoles = computed(() => this.userRoles()?.currentRoles || []);
  selectableRoles = computed(() => this.availableRoles());

  // Proper change detection using reactive forms
  hasChanges = computed(() => {
    // React to form changes
    this.formValue();

    const initialIds = this.initialSelectedIds();
    const currentSelectedIds = this.getSelectedRoleIds();

    if (initialIds.size !== currentSelectedIds.size) return true;

    for (const id of currentSelectedIds) {
      if (!initialIds.has(id)) return true;
    }

    for (const id of initialIds) {
      if (!currentSelectedIds.has(id)) return true;
    }

    return false;
  });

  selectedCount = computed(() => this.getSelectedRoleIds().size);

  // Cooldown computed properties
  isOnCooldown = computed(() => {
    const cooldownEnd = this.cooldownEndTime();
    return cooldownEnd > Date.now();
  });

  canSubmit = computed(() => {
    return this.hasChanges() && !this.isSaving() && !this.isOnCooldown();
  });

  cooldownMessage = computed(() => {
    const remaining = this.remainingCooldown();
    if (remaining <= 0) return '';

    const attempts = this.updateAttempts();
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;

    if (minutes > 0) {
      return `Aguarde ${minutes}min ${seconds}s antes de atualizar novamente (${attempts} tentativas recentes).`;
    }

    return `Aguarde ${seconds}s antes de atualizar novamente (${attempts} tentativas recentes).`;
  });

  // Get selected role IDs from the reactive form
  private getSelectedRoleIds(): Set<string> {
    const selectedIds = new Set<string>();
    const formValue = this.roleForm.value;

    Object.keys(formValue).forEach((roleId) => {
      if (formValue[roleId] === true) {
        selectedIds.add(roleId);
      }
    });

    return selectedIds;
  }

  ngOnInit(): void {
    this.loadAvailableRoles();
    this.startCooldownTimer();
  }

  ngOnDestroy(): void {
    this.clearCooldownTimer();
  }

  private startCooldownTimer(): void {
    this.clearCooldownTimer(); // Clear any existing timer first

    // Update remaining cooldown every second
    this.cooldownTimer = setInterval(() => {
      const cooldownEnd = this.cooldownEndTime();
      if (cooldownEnd > Date.now()) {
        this.remainingCooldown.set(Math.ceil((cooldownEnd - Date.now()) / 1000));
      } else {
        // Cooldown has expired, just clear the time-based signals
        // Keep updateAttempts for tracking, only clear cooldownEndTime
        this.remainingCooldown.set(0);
        this.cooldownEndTime.set(0);
        // Don't reset updateAttempts here - let it be cleared on successful submit
      }
    }, 1000);
  }

  private clearCooldownTimer(): void {
    if (this.cooldownTimer) {
      clearInterval(this.cooldownTimer);
      this.cooldownTimer = null;
    }
  }

  private setCooldown(attempts: number): void {
    const cooldownSeconds = Math.pow(2, attempts); // 2^n seconds
    const cooldownEnd = Date.now() + cooldownSeconds * 1000;

    this.updateAttempts.set(attempts);
    this.cooldownEndTime.set(cooldownEnd);
    this.remainingCooldown.set(cooldownSeconds);
  }

  private clearCooldown(): void {
    this.updateAttempts.set(0);
    this.cooldownEndTime.set(0);
    this.remainingCooldown.set(0);
  }

  private loadAvailableRoles(): void {
    this.isLoading.set(true);
    this.apiService.getSelectableDiscordRoles().subscribe({
      next: (roles: DiscordRole[]) => {
        this.errorMessage.set('');
        this.updateErrorMessage.set('');
        this.availableRoles.set(roles);
        this.setupRoleForm(roles);
        // Initialize selected roles with user's current roles
        this.loadUserRoles();
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error loading available Discord roles:', error);
        this.availableRoles.set([]);
        this.userRoles.set(null);
        this.initialSelectedIds.set(new Set());
        this.errorAction.set('retry');
        this.errorMessage.set('Não foi possível carregar os cargos disponíveis. Tente novamente.');
        this.snackBar.open('Não foi possível carregar os cargos disponíveis.', 'Fechar', { duration: 5000 });
        this.isLoading.set(false);
      },
    });
  }

  private setupRoleForm(roles: DiscordRole[]): void {
    const formControls: { [key: string]: FormControl } = {};
    roles.forEach((role) => {
      formControls[role.id] = new FormControl(false);
    });
    this.roleForm = this.formBuilder.group(formControls);

    // Subscribe to form changes to trigger reactivity
    this.roleForm.valueChanges.subscribe(() => {
      this.formChangeSignal.update((val) => val + 1);
    });
  }

  private loadUserRoles(): void {
    this.apiService.getUserDiscordRoles().subscribe({
      next: (userRoles: UserRoles) => {
        this.userRoles.set(userRoles);

        // Set initial selected IDs from user's current roles
        const currentRoleIds = new Set(userRoles.currentRoles.map((role) => role.id));
        this.initialSelectedIds.set(currentRoleIds);

        // Update form controls with current user roles
        this.availableRoles().forEach((role) => {
          const control = this.roleForm.get(role.id);
          if (control) {
            control.setValue(currentRoleIds.has(role.id));
          }
        });

        // Trigger form change detection after setting initial values
        this.formChangeSignal.update((val) => val + 1);

        this.isLoading.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error loading user Discord roles:', error);
        let errorMessage = 'Não foi possível carregar seus cargos atuais. Tente novamente.';
        let errorAction: RoleSelectionErrorAction = 'retry';

        if (error.status === 400) {
          errorMessage = 'Vincule sua conta do Discord para gerenciar seus cargos.';
          errorAction = 'link';
        } else if (error.status === 401) {
          errorMessage = 'Faça login para gerenciar seus cargos do Discord.';
          errorAction = 'login';
        } else if (error.status === 500) {
          errorMessage = 'Erro no servidor. Tente novamente mais tarde.';
        }

        this.errorMessage.set(errorMessage);
        this.errorAction.set(errorAction);
        this.isLoading.set(false);
      },
    });
  }

  onSubmit(): void {
    this.saveChanges();
  }

  onReset(): void {
    this.resetChanges();
  }

  // Remove this method - no longer needed with reactive forms
  isRoleSelected(roleId: string): boolean {
    const control = this.roleForm.get(roleId);
    return control?.value || false;
  }

  saveChanges(): void {
    if (!this.hasChanges()) return;

    if (this.isOnCooldown()) {
      return;
    }

    this.isSaving.set(true);
    this.updateErrorMessage.set('');
    // Disable form during save
    this.roleForm.disable();

    const selectedIds = Array.from(this.getSelectedRoleIds());

    this.apiService.updateUserDiscordRoles({ selectedRoleIds: selectedIds }).subscribe({
      next: (response: RoleSelectionResponse) => {
        this.successMessage.set(response.message || 'Seus cargos do Discord foram atualizados.');
        // Clear success message after 3 seconds
        setTimeout(() => this.successMessage.set(''), 3000);

        // Clear cooldown on successful update
        this.clearCooldown();

        // Update initial state and re-enable form
        this.initialSelectedIds.set(new Set(selectedIds));
        this.roleForm.enable();
        this.isSaving.set(false);

        // Trigger form change detection after successful update
        this.formChangeSignal.update((val) => val + 1);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error updating Discord roles:', error);
        let errorMessage = 'Não foi possível atualizar seus cargos do Discord. Tente novamente.';

        // Handle cooldown from backend
        if (error.status === 429) {
          const attempts = error.error?.attempts || this.updateAttempts() + 1;
          const cooldownSeconds = error.error?.cooldownSeconds || Math.pow(2, attempts);

          this.setCooldown(attempts);
          errorMessage = `Muitas tentativas. Aguarde ${cooldownSeconds}s antes de tentar novamente.`;
        } else {
          // Increment attempts on other errors and set cooldown
          const newAttempts = this.updateAttempts() + 1;
          this.setCooldown(newAttempts);

          if (error.status === 400) {
            errorMessage = error.error?.message || 'Alguns cargos não puderam ser atribuídos. Confira sua seleção.';
          }
        }

        this.updateErrorMessage.set(errorMessage);
        // Clear error message after 5 seconds
        setTimeout(() => this.updateErrorMessage.set(''), 5000);

        // Re-enable form
        this.roleForm.enable();
        this.isSaving.set(false);
      },
    });
  }

  resetChanges(): void {
    // Reset form to initial state (current user roles)
    const currentRoleIds = this.initialSelectedIds();
    this.availableRoles().forEach((role) => {
      const control = this.roleForm.get(role.id);
      if (control) {
        control.setValue(currentRoleIds.has(role.id));
      }
    });

    // Trigger form change detection after reset
    this.formChangeSignal.update((val) => val + 1);
  }

  clearAllRoles(): void {
    this.availableRoles().forEach((role) => {
      const control = this.roleForm.get(role.id);
      if (control) {
        control.setValue(false);
      }
    });

    // Trigger form change detection
    this.formChangeSignal.update((val) => val + 1);
  }

  redirectToLogin(): void {
    // Navigate to login page - you might need to inject Router for this
    window.location.href = '/app/login';
  }

  redirectToDiscordLink(): void {
    // Navigate to Discord linking page
    window.location.href = '/app/discord/link';
  }

  retryLoading(): void {
    this.errorMessage.set('');
    this.updateErrorMessage.set('');
    this.loadAvailableRoles();
  }
}
