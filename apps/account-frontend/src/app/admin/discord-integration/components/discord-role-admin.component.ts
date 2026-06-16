import {
  Component,
  OnInit,
  signal,
  inject,
  computed,
  ChangeDetectionStrategy,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import {
  ReactiveFormsModule,
  FormBuilder,
  FormArray,
  FormControl,
} from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatDividerModule } from '@angular/material/divider';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatDialogModule } from '@angular/material/dialog';
import { HttpErrorResponse } from '@angular/common/http';
import {
  DiscordRoleConfirmationDialogComponent,
  type DiscordRoleChange,
  type RoleChangeData,
} from './discord-role-confirmation-dialog.component';
import { ApiService } from '../../../shared/services/api.service';
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
    MatChipsModule,
    MatDialogModule,
    ReactiveFormsModule,
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
  rolesWithPermissions = computed(
    () => this.selectableRoles()?.rolesWithPermissions || [],
  );

  rolesWithoutPermissions = computed(
    () => this.selectableRoles()?.rolesWithoutPermissions || [],
  );

  currentlyEnabledRoles = computed(
    () => this.selectableRoles()?.selectableRoles || [],
  );

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
        this.snackBar.open('Error loading Discord roles', 'Close', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
      },
    });
  }

  private setupFormArrays(roles: SelectableRoles): void {
    const enabledRoleIds = new Set(
      roles.selectableRoles.map((role) => role.id),
    );

    // Store initial selected IDs for change detection
    this.initialSelectedIds.set(new Set(enabledRoleIds));

    // Clear existing form arrays
    this.rolesWithPermissionsArray.clear();
    this.rolesWithoutPermissionsArray.clear();

    // Add controls for roles with permissions
    roles.rolesWithPermissions.forEach((role) => {
      // Blacklisted roles should always be false and disabled
      const initialValue = role.isBlacklisted
        ? false
        : enabledRoleIds.has(role.id);
      const control = new FormControl({
        value: initialValue,
        disabled: role.isBlacklisted,
      });

      this.rolesWithPermissionsArray.push(control);
    });

    // Add controls for roles without permissions
    roles.rolesWithoutPermissions.forEach((role) => {
      // Blacklisted roles should always be false and disabled
      const initialValue = role.isBlacklisted
        ? false
        : enabledRoleIds.has(role.id);
      const control = new FormControl({
        value: initialValue,
        disabled: role.isBlacklisted,
      });

      this.rolesWithoutPermissionsArray.push(control);
    });

    // Mark form as pristine after initial setup
    this.roleForm.markAsPristine();
  }

  getControlForRole(
    roleType: 'withPermissions' | 'withoutPermissions',
    index: number,
  ): FormControl {
    const array =
      roleType === 'withPermissions'
        ? this.rolesWithPermissionsArray
        : this.rolesWithoutPermissionsArray;
    return array.at(index) as FormControl;
  }

  isRoleSelected(
    roleType: 'withPermissions' | 'withoutPermissions',
    index: number,
  ): boolean {
    return this.getControlForRole(roleType, index).value || false;
  }

  handleRoleClick(
    event: Event,
    index: number,
    section: 'rolesWithPermissions' | 'rolesWithoutPermissions',
  ): void {
    const mouseEvent = event as MouseEvent;
    const roles =
      section === 'rolesWithPermissions'
        ? this.rolesWithPermissions()
        : this.rolesWithoutPermissions();
    const currentRole = roles[index];

    // Don't handle clicks on blacklisted roles
    if (currentRole?.isBlacklisted) {
      return;
    }

    const formArray =
      section === 'rolesWithPermissions'
        ? this.rolesWithPermissionsArray
        : this.rolesWithoutPermissionsArray;

    // If shift is held and we have a previous anchor in the same section
    if (
      mouseEvent.shiftKey &&
      this.lastClickedIndex &&
      this.lastClickedIndex.section === section
    ) {
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

      // Set all non-blacklisted items in the range to match the anchor state
      for (let i = startIndex; i <= endIndex; i++) {
        const roleInRange = roles[i];
        // Skip blacklisted roles in range selection
        if (roleInRange?.isBlacklisted) {
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
      // Update the anchor point for future shift+click operations (only for non-blacklisted roles)
      requestAnimationFrame(() => {
        this.lastClickedIndex = { section, index };
      });
    }
  }

  isAnchorPoint(
    index: number,
    section: 'rolesWithPermissions' | 'rolesWithoutPermissions',
  ): boolean {
    if (
      this.lastClickedIndex?.section !== section ||
      this.lastClickedIndex?.index !== index
    ) {
      return false;
    }

    // Ensure the anchor point is not a blacklisted role
    const roles =
      section === 'rolesWithPermissions'
        ? this.rolesWithPermissions()
        : this.rolesWithoutPermissions();
    const role = roles[index];

    return !role?.isBlacklisted;
  }

  saveChanges(): void {
    if (!this.hasChanges() || !this.roleForm.valid) return;

    const changes = this.getChanges();

    if (changes.length === 0) {
      this.snackBar.open('No changes to save', 'Close', {
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

  private findRoleById(
    roleId: string,
    roles: SelectableRoles,
  ): DiscordRole | undefined {
    return [
      ...roles.rolesWithPermissions,
      ...roles.rolesWithoutPermissions,
    ].find((role) => role.id === roleId);
  }

  private hexToNumber(hexColor: string): number {
    const normalizedColor = this.normalizeRoleColor(hexColor);
    if (normalizedColor === '#99aab5') return 0;
    return parseInt(normalizedColor.replace('#', ''), 16);
  }

  private applyChanges(): void {
    this.isSaving.set(true);
    const selectedIds = this.getSelectedRoleIds();

    this.apiService
      .updateDiscordRoleSelection({ enabledRoleIds: selectedIds })
      .subscribe({
        next: () => {
          this.snackBar.open('Role selection updated successfully!', 'Close', {
            duration: 3000,
          });

          // Update the initial state to reflect the changes
          this.initialSelectedIds.set(new Set(selectedIds));
          this.roleForm.markAsPristine();
          this.isSaving.set(false);
        },
        error: (error: HttpErrorResponse) => {
          console.error('Error updating role selection:', error);
          this.snackBar.open(
            'Failed to update role selection. Please try again.',
            'Close',
            { duration: 5000 },
          );
          this.isSaving.set(false);
        },
      });
  }

  private getSelectedRoleIds(): string[] {
    const selectedIds: string[] = [];
    const roles = this.selectableRoles();

    if (!roles) return selectedIds;

    // Check roles with permissions (exclude blacklisted)
    roles.rolesWithPermissions.forEach((role, index) => {
      if (
        !role.isBlacklisted &&
        this.rolesWithPermissionsArray.at(index)?.value
      ) {
        selectedIds.push(role.id);
      }
    });

    // Check roles without permissions (exclude blacklisted)
    roles.rolesWithoutPermissions.forEach((role, index) => {
      if (
        !role.isBlacklisted &&
        this.rolesWithoutPermissionsArray.at(index)?.value
      ) {
        selectedIds.push(role.id);
      }
    });

    return selectedIds;
  }

  syncRoles(): void {
    this.isSyncing.set(true);

    this.apiService.syncDiscordRoles().subscribe({
      next: () => {
        this.snackBar.open('Discord roles synced successfully!', 'Close', {
          duration: 3000,
        });
        this.loadRoles(); // Reload to get updated roles
        this.isSyncing.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error syncing Discord roles:', error);
        this.snackBar.open(
          'Failed to sync Discord roles. Please try again.',
          'Close',
          { duration: 5000 },
        );
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

  getRoleColor(role: DiscordRole): string {
    return this.normalizeRoleColor(role.color);
  }

  getRoleTextColor(role: DiscordRole): '#000000' | '#ffffff' {
    return this.getReadableTextColor(this.getRoleColor(role));
  }

  private normalizeRoleColor(color: string | null | undefined): string {
    if (!color || color === '#000000') {
      return '#99aab5';
    }

    const trimmed = color.trim();
    if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
      const [, r, g, b] = trimmed;
      return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
    }

    return '#99aab5';
  }

  private getReadableTextColor(color: string): '#000000' | '#ffffff' {
    const luminance = this.getRelativeLuminance(color);
    const contrastWithBlack = (luminance + 0.05) / 0.05;
    const contrastWithWhite = 1.05 / (luminance + 0.05);

    return contrastWithBlack >= contrastWithWhite ? '#000000' : '#ffffff';
  }

  private getRelativeLuminance(color: string): number {
    const red = parseInt(color.slice(1, 3), 16);
    const green = parseInt(color.slice(3, 5), 16);
    const blue = parseInt(color.slice(5, 7), 16);

    const [linearRed, linearGreen, linearBlue] = [red, green, blue].map(
      (channel) => {
        const value = channel / 255;
        return value <= 0.03928
          ? value / 12.92
          : Math.pow((value + 0.055) / 1.055, 2.4);
      },
    );

    return 0.2126 * linearRed + 0.7152 * linearGreen + 0.0722 * linearBlue;
  }
}
