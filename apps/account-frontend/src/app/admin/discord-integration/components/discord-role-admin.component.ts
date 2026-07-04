import { Component, OnInit, signal, inject, computed, ChangeDetectionStrategy } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import { ReactiveFormsModule, FormBuilder, FormArray, FormControl } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DiscordRoleConfirmationDialogComponent,
  type DiscordRoleChange,
  type RoleChangeData,
} from './discord-role-confirmation-dialog.component';
import { DiscordRoleOptionComponent } from '../../../shared/components/discord-role-option.component';
import { ApiService } from '../../../shared/services/api.service';
import { normalizeDiscordRoleColor } from '../../../shared/utils/discord-role-color.util';
import type { DiscordRole, SelectableRoles } from '@cacic/shared-types';

@Component({
  selector: 'app-discord-role-admin',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatSnackBarModule,
    MatCheckboxModule,
    MatDividerModule,
    MatDialogModule,
    ReactiveFormsModule,
    DiscordRoleOptionComponent,
  ],
  templateUrl: './discord-role-admin.component.html',
  styleUrl: './discord-role-admin.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordRoleAdminComponent implements OnInit {
  private apiService = inject(ApiService);
  private snackBar = inject(MatSnackBar);
  private formBuilder = inject(FormBuilder);
  private dialog = inject(MatDialog);

  // Form
  roleForm = this.formBuilder.group({
    rolesWithPermissions: this.formBuilder.array([]),
    rolesWithoutPermissions: this.formBuilder.array([]),
  });

  // State signals
  isLoading = signal<boolean>(true);
  isSaving = signal<boolean>(false);
  isSyncing = signal<boolean>(false);
  selectableRoles = signal<SelectableRoles | null>(null);
  initialSelectedIds = signal<Set<string>>(new Set());

  // Convert form valueChanges to signal
  formValue = toSignal(this.roleForm.valueChanges, {
    initialValue: this.roleForm.value,
  });

  // Multi-selection state
  private lastClickedIndex: { section: string; index: number } | null = null;

  // Computed properties
  rolesWithPermissions = computed(() => this.selectableRoles()?.rolesWithPermissions || []);

  rolesWithoutPermissions = computed(() => this.selectableRoles()?.rolesWithoutPermissions || []);

  hasChanges = computed(() => {
    const roles = this.selectableRoles();
    // This will automatically react to form changes via toSignal
    this.formValue();

    if (!roles) return false;

    const currentSelectedIds = new Set(this.getSelectedRoleIds());
    const initialIds = this.initialSelectedIds();

    // Check if sets are different
    if (currentSelectedIds.size !== initialIds.size) {
      return true;
    }

    for (const id of currentSelectedIds) {
      if (!initialIds.has(id)) {
        return true;
      }
    }

    // Check if any initial IDs are missing from current
    for (const id of initialIds) {
      if (!currentSelectedIds.has(id)) {
        return true;
      }
    }

    return false;
  });

  // Form array getters
  get rolesWithPermissionsArray(): FormArray {
    return this.roleForm.get('rolesWithPermissions') as FormArray;
  }

  get rolesWithoutPermissionsArray(): FormArray {
    return this.roleForm.get('rolesWithoutPermissions') as FormArray;
  }

  ngOnInit(): void {
    this.loadRoles();
  }

  private loadRoles(): void {
    this.isLoading.set(true);
    this.apiService.getDiscordRolesAdmin().subscribe({
      next: (roles: SelectableRoles) => {
        this.selectableRoles.set(roles);
        this.setupFormArrays(roles);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Error loading Discord roles:', error);
        this.isLoading.set(false);
        this.snackBar.open('Não foi possível carregar os cargos.', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      },
    });
  }

  private setupFormArrays(roles: SelectableRoles): void {
    const enabledRoleIds = new Set(roles.selectableRoles.map((role) => role.id));

    // Store initial selected IDs for change detection
    this.initialSelectedIds.set(new Set(enabledRoleIds));

    // Clear existing form arrays
    this.rolesWithPermissionsArray.clear();
    this.rolesWithoutPermissionsArray.clear();

    // Add controls for roles with permissions
    roles.rolesWithPermissions.forEach((role) => {
      const isSelectable = this.isRoleSelectable(role);
      const initialValue = !isSelectable ? false : enabledRoleIds.has(role.id);
      const control = new FormControl({
        value: initialValue,
        disabled: !isSelectable,
      });

      this.rolesWithPermissionsArray.push(control);
    });

    // Add controls for roles without permissions
    roles.rolesWithoutPermissions.forEach((role) => {
      const isSelectable = this.isRoleSelectable(role);
      const initialValue = !isSelectable ? false : enabledRoleIds.has(role.id);
      const control = new FormControl({
        value: initialValue,
        disabled: !isSelectable,
      });

      this.rolesWithoutPermissionsArray.push(control);
    });

    // Mark form as pristine after initial setup
    this.roleForm.markAsPristine();
  }

  getControlForRole(roleType: 'withPermissions' | 'withoutPermissions', index: number): FormControl {
    const array = roleType === 'withPermissions' ? this.rolesWithPermissionsArray : this.rolesWithoutPermissionsArray;
    return array.at(index) as FormControl;
  }

  isRoleSelected(roleType: 'withPermissions' | 'withoutPermissions', index: number): boolean {
    return this.getControlForRole(roleType, index).value || false;
  }

  handleRoleClick(event: Event, index: number, section: 'rolesWithPermissions' | 'rolesWithoutPermissions'): void {
    const mouseEvent = event as MouseEvent;
    const roles = section === 'rolesWithPermissions' ? this.rolesWithPermissions() : this.rolesWithoutPermissions();
    const currentRole = roles[index];

    if (!currentRole || !this.isRoleSelectable(currentRole)) {
      return;
    }

    const formArray =
      section === 'rolesWithPermissions' ? this.rolesWithPermissionsArray : this.rolesWithoutPermissionsArray;

    // If shift is held and we have a previous anchor in the same section
    if (mouseEvent.shiftKey && this.lastClickedIndex && this.lastClickedIndex.section === section) {
      // Prevent the default checkbox behavior
      event.preventDefault();
      event.stopPropagation();

      const anchorIndex = this.lastClickedIndex.index;
      const currentIndex = index;

      const startIndex = Math.min(anchorIndex, currentIndex);
      const endIndex = Math.max(anchorIndex, currentIndex);

      // Get the current state of the anchor item (before any changes)
      const anchorControl = formArray.at(anchorIndex);
      const anchorValue = anchorControl?.value || false;

      // Set all selectable items in the range to match the anchor state
      for (let i = startIndex; i <= endIndex; i++) {
        const roleInRange = roles[i];
        if (!roleInRange || !this.isRoleSelectable(roleInRange)) {
          continue;
        }

        const control = formArray.at(i);
        if (control) {
          control.setValue(anchorValue);
          control.markAsDirty();
        }
      }

      // Keep the same anchor point for further shift+click operations
    } else {
      // Normal click - the checkbox will toggle automatically due to form control binding
      // Update the anchor point for future shift+click operations
      requestAnimationFrame(() => {
        this.lastClickedIndex = { section, index };
      });
    }
  }

  isAnchorPoint(index: number, section: 'rolesWithPermissions' | 'rolesWithoutPermissions'): boolean {
    if (this.lastClickedIndex?.section !== section || this.lastClickedIndex?.index !== index) {
      return false;
    }

    const roles = section === 'rolesWithPermissions' ? this.rolesWithPermissions() : this.rolesWithoutPermissions();
    const role = roles[index];

    return role ? this.isRoleSelectable(role) : false;
  }

  saveChanges(): void {
    if (!this.hasChanges() || !this.roleForm.valid) return;

    const changes = this.getChanges();

    if (changes.length === 0) {
      this.snackBar.open('Nenhuma alteração para salvar.', 'Fechar', {
        duration: 3000,
      });
      return;
    }

    const dialogRef = this.dialog.open(DiscordRoleConfirmationDialogComponent, {
      width: '600px',
      maxHeight: '80vh',
      data: { changes } as RoleChangeData,
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((confirmed: boolean) => {
      if (confirmed) {
        this.applyChanges();
      }
    });
  }

  private getChanges(): DiscordRoleChange[] {
    const roles = this.selectableRoles();
    if (!roles) return [];

    const currentSelectedIds = new Set(this.getSelectedRoleIds());
    const initialIds = this.initialSelectedIds();

    const changes: DiscordRoleChange[] = [];

    // Find added roles
    for (const roleId of currentSelectedIds) {
      if (!initialIds.has(roleId)) {
        const role = this.findRoleById(roleId, roles);
        if (role) {
          changes.push({
            roleId: role.id,
            name: role.name,
            color: this.hexToNumber(role.color),
            permissions: role.hasPermissions ? ['ADMINISTRATOR'] : [],
            type: 'added',
          });
        }
      }
    }

    // Find removed roles
    for (const roleId of initialIds) {
      if (!currentSelectedIds.has(roleId)) {
        const role = this.findRoleById(roleId, roles);
        if (role) {
          changes.push({
            roleId: role.id,
            name: role.name,
            color: this.hexToNumber(role.color),
            permissions: role.hasPermissions ? ['ADMINISTRATOR'] : [],
            type: 'removed',
          });
        }
      }
    }

    return changes;
  }

  private findRoleById(roleId: string, roles: SelectableRoles): DiscordRole | undefined {
    return [...roles.rolesWithPermissions, ...roles.rolesWithoutPermissions].find((role) => role.id === roleId);
  }

  private hexToNumber(hexColor: string): number {
    const normalizedColor = normalizeDiscordRoleColor(hexColor);
    if (normalizedColor === '#99aab5') return 0;
    return parseInt(normalizedColor.replace('#', ''), 16);
  }

  private applyChanges(): void {
    this.isSaving.set(true);
    const selectedIds = this.getSelectedRoleIds();

    this.apiService.updateDiscordRoleSelection({ enabledRoleIds: selectedIds }).subscribe({
      next: () => {
        this.snackBar.open('Cargos atualizados.', 'Fechar', {
          duration: 3000,
        });

        // Update the initial state to reflect the changes
        this.initialSelectedIds.set(new Set(selectedIds));
        this.roleForm.markAsPristine();
        this.isSaving.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error updating role selection:', error);
        this.snackBar.open('Não foi possível salvar os cargos.', 'Fechar', { duration: 5000 });
        this.isSaving.set(false);
      },
    });
  }

  private getSelectedRoleIds(): string[] {
    const selectedIds: string[] = [];
    const roles = this.selectableRoles();

    if (!roles) return selectedIds;

    // Check roles with permissions
    roles.rolesWithPermissions.forEach((role, index) => {
      if (this.isRoleSelectable(role) && this.rolesWithPermissionsArray.at(index)?.value) {
        selectedIds.push(role.id);
      }
    });

    // Check roles without permissions
    roles.rolesWithoutPermissions.forEach((role, index) => {
      if (this.isRoleSelectable(role) && this.rolesWithoutPermissionsArray.at(index)?.value) {
        selectedIds.push(role.id);
      }
    });

    return selectedIds;
  }

  isRoleSelectable(role: DiscordRole): boolean {
    return !role.isBlacklisted && !role.hasPermissions;
  }

  syncRoles(): void {
    this.isSyncing.set(true);

    this.apiService.syncDiscordRoles().subscribe({
      next: () => {
        this.snackBar.open('Cargos sincronizados.', 'Fechar', {
          duration: 3000,
        });
        this.loadRoles(); // Reload to get updated roles
        this.isSyncing.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error syncing Discord roles:', error);
        this.snackBar.open('Não foi possível sincronizar os cargos.', 'Fechar', { duration: 5000 });
        this.isSyncing.set(false);
      },
    });
  }

  resetChanges(): void {
    const roles = this.selectableRoles();
    if (roles) {
      this.setupFormArrays(roles);
    }
  }
}
