import { ChangeDetectionStrategy, Component, inject, signal, computed } from '@angular/core';
import { Router } from '@angular/router';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialogModule, MatDialog } from '@angular/material/dialog';
import { ProfileDataHelpComponent } from '../../../shared/components/profile-data-help/profile-data-help.component';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../shared/services/auth/auth.service';
import type { User } from '@cacic/shared-types';
import { ProfileFormComponent } from '../../../shared/components/profile-form/profile-form.component';
import { LoggerService } from '../../../shared/services/logger.service';
import { describeProfileSaveError } from '../../../shared/components/profile-form/profile-save-error';

@Component({
  selector: 'app-edit',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatIconModule,
    MatTooltipModule,
    MatDialogModule,
    ProfileDataHelpComponent,
    MatButtonModule,
    ProfileFormComponent,
  ],
  templateUrl: './edit.component.html',
  styleUrl: './edit.component.scss',
})
export class EditProfileComponent {
  readonly dialog = inject(MatDialog);
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);

  isSubmitting = signal(false);

  // Computed property for initial form data (always loads from current user for auto-fill)
  initialFormData = computed(() => {
    const currentUser = this.authService.currentUser();
    if (!currentUser) return {};

    return {
      fullname: currentUser.fullname || currentUser.displayName || '',
      phone: currentUser.phone || '',
      enrollmentNumber: currentUser.enrollmentNumber || '',
      isForeigner: currentUser.isForeigner || false,
      identityDocument: currentUser.identityDocument || '',
      passportCountry: currentUser.passportCountry,
      unespRole: currentUser.unespRole,
    };
  });

  identityFieldLocks = computed(() => {
    const currentUser = this.authService.currentUser();

    return {
      fullName: !!currentUser?.fullname?.trim(),
      identityDocument: !!currentUser?.identityDocument?.trim(),
    };
  });

  onSavingChange(isSaving: boolean): void {
    this.isSubmitting.set(isSaving);
  }

  onProfileSaveSuccess(updatedUser: User): void {
    this.logger.debug('Profile update successful', { operation: 'profile-update', userId: updatedUser.id });

    this.snackBar.open('Dados atualizados com sucesso!', 'Fechar', {
      duration: 3000,
      panelClass: ['success-snackbar'],
    });

    this.router.navigateByUrl('/settings');
  }

  onProfileSaveError(error: unknown): void {
    this.logger.error('Profile update failed', error, { operation: 'profile-update' });
    this.isSubmitting.set(false);
    this.snackBar.open(describeProfileSaveError(error, true).message, 'Fechar', {
      duration: 7000,
      panelClass: ['error-snackbar'],
    });
  }

  cancel(): void {
    this.router.navigateByUrl('/settings');
  }
}
