import { Component, Inject, computed } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';


export interface DiscordRoleChange {
  roleId: string;
  name: string;
  color: number;
  permissions: string[];
  type: 'added' | 'removed';
}

export interface RoleChangeData {
  changes: DiscordRoleChange[];
}

@Component({
  selector: 'app-discord-role-confirmation-dialog',
  template: `
    <div mat-dialog-title class="dialog-title">
      <mat-icon>manage_accounts</mat-icon>
      <span>Confirm Role Changes</span>
    </div>

    <mat-dialog-content class="dialog-content">
      @if (hasChanges()) {
        <p class="description">
          Review the changes below before applying them to the Discord role
          configuration:
        </p>

        @if (addedRoles().length > 0) {
          <div class="change-section added-section">
            <h3 class="section-title">
              <mat-icon class="section-icon added">add_circle</mat-icon>
              Roles to be made selectable ({{ addedRoles().length }})
            </h3>
            <div class="roles-grid">
              @for (role of addedRoles(); track role.roleId) {
                <mat-chip
                  class="role-chip added-chip"
                  [style.background-color]="formatColor(role.color)"
                  [style.color]="getTextColor(role.color)"
                >
                  {{ role.name }}
                </mat-chip>
              }
            </div>
          </div>
        }

        @if (removedRoles().length > 0) {
          <div class="change-section removed-section">
            <h3 class="section-title">
              <mat-icon class="section-icon removed">remove_circle</mat-icon>
              Roles to be removed from selection ({{ removedRoles().length }})
            </h3>
            <div class="roles-grid">
              @for (role of removedRoles(); track role.roleId) {
                <mat-chip
                  class="role-chip removed-chip"
                  [style.background-color]="formatColor(role.color)"
                  [style.color]="getTextColor(role.color)"
                >
                  {{ role.name }}
                </mat-chip>
              }
            </div>
          </div>
        }

        <div class="warning-section">
          <mat-icon class="warning-icon">warning</mat-icon>
          <p class="warning-text">
            These changes will immediately affect which roles users can select.
            Make sure these changes are intentional.
          </p>
        </div>
      } @else {
        <div class="no-changes">
          <mat-icon class="info-icon">info</mat-icon>
          <p>No changes detected in the role configuration.</p>
        </div>
      }
    </mat-dialog-content>

    <mat-dialog-actions class="dialog-actions">
      <button mat-button (click)="onCancel()">Cancel</button>
      <button
        mat-raised-button
        color="primary"
        [disabled]="!hasChanges()"
        (click)="onConfirm()"
      >
        Apply Changes
      </button>
    </mat-dialog-actions>
  `,
  styles: [
    `
      .dialog-title {
        display: flex;
        align-items: center;
        gap: 8px;
        font-size: 1.25rem;
        font-weight: 500;
        margin-bottom: 16px;
      }

      .dialog-content {
        min-width: 500px;
        max-width: 700px;
        max-height: 60vh;
        overflow-y: auto;
      }

      .description {
        margin: 0 0 24px 0;
        color: var(--mat-sys-on-surface-variant);
      }

      .change-section {
        margin-bottom: 24px;
      }

      .section-title {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 12px 0;
        font-size: 1rem;
        font-weight: 500;
      }

      .section-icon.added {
        color: var(--mat-sys-primary);
      }

      .section-icon.removed {
        color: var(--mat-sys-error);
      }

      .roles-grid {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
      }

      .role-chip {
        position: relative;
        font-weight: 500;
        border-radius: 16px;
      }

      .added-chip {
        border: 2px solid var(--mat-sys-primary);
      }

      .removed-chip {
        border: 2px solid var(--mat-sys-error);
        opacity: 0.7;
      }

      .warning-section {
        display: flex;
        align-items: flex-start;
        gap: 8px;
        padding: 16px;
        background-color: var(--mat-sys-warning-container);
        border-radius: 8px;
        margin-top: 16px;
      }

      .warning-icon {
        color: var(--mat-sys-warning);
        margin-top: 2px;
      }

      .warning-text {
        margin: 0;
        color: var(--mat-sys-on-warning-container);
        font-size: 0.875rem;
      }

      .no-changes {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 24px;
        text-align: center;
        justify-content: center;
        color: var(--mat-sys-on-surface-variant);
      }

      .info-icon {
        color: var(--mat-sys-primary);
      }

      .dialog-actions {
        justify-content: flex-end;
        gap: 8px;
        padding-top: 16px;
      }
    `,
  ],
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule
],
})
export class DiscordRoleConfirmationDialogComponent {
  constructor(
    private dialogRef: MatDialogRef<DiscordRoleConfirmationDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: RoleChangeData,
  ) {}

  readonly addedRoles = computed(() =>
    this.data.changes.filter((change) => change.type === 'added'),
  );

  readonly removedRoles = computed(() =>
    this.data.changes.filter((change) => change.type === 'removed'),
  );

  readonly hasChanges = computed(() => this.data.changes.length > 0);

  formatColor(color: number): string {
    if (color === 0) return '#99aab5'; // Default Discord gray
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  getTextColor(color: number): string {
    if (color === 0) return '#2c2f33';

    // Convert to RGB
    const r = (color >> 16) & 255;
    const g = (color >> 8) & 255;
    const b = color & 255;

    // Calculate luminance
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;

    return luminance > 0.5 ? '#2c2f33' : '#ffffff';
  }

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
