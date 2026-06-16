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
                  [style.--mdc-chip-elevated-container-color]="formatColor(role.color)"
                  [style.--mdc-chip-label-text-color]="getTextColor(role.color)"
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
                  [style.--mdc-chip-elevated-container-color]="formatColor(role.color)"
                  [style.--mdc-chip-label-text-color]="getTextColor(role.color)"
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
    MatChipsModule,
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

  getTextColor(color: number): '#000000' | '#ffffff' {
    const luminance = this.getRelativeLuminance(this.formatColor(color));
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

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
