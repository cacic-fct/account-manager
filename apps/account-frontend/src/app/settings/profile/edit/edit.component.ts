import { Component, inject, signal, computed, ChangeDetectionStrategy } from '@angular/core';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AuthService } from '../../../shared/services/auth/auth.service';
import type { User } from '@cacic/shared-types';
import { ProfileFormComponent } from '../../../shared/components/profile-form/profile-form.component';

@Component({
  selector: 'app-edit',
  imports: [MatCardModule, MatButtonModule, ProfileFormComponent],
  templateUrl: './edit.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './edit.component.scss',
})
export class EditProfileComponent {
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);

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
    console.log('Profile update successful:', updatedUser);

    this.snackBar.open('Dados atualizados com sucesso!', 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
    });

    this.router.navigateByUrl('/settings');
  }

  onProfileSaveError(error: unknown): void {
    console.error('Profile update error:', error);
    this.snackBar.open('Failed to update profile. Please try again.', 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar'],
    });
  }

  cancel(): void {
    this.router.navigateByUrl('/settings');
  }
}
