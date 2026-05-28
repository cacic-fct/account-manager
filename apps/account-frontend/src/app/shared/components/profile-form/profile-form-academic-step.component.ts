import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { UnespRole } from '@cacic/shared-types';

@Component({
  selector: 'app-profile-form-academic-step',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    MatCardModule,
  ],
  templateUrl: './profile-form-academic-step.component.html',
  styleUrl: './profile-form-academic-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileFormAcademicStepComponent {
  formGroup = input.required<FormGroup>();
  shouldShowUnespRoleSelection = input<boolean>(false);
  showEnrollmentNumber = input<boolean>(false);
  unespRoleOptions = input<Array<{ value: UnespRole; label: string }>>([]);

  isEditMode = input<boolean>(false);
  isUserVerified = input<boolean>(false);
  unespRoleWillReset = input<boolean>(false);
  enrollmentWillReset = input<boolean>(false);

  hasError(controlName: string, errorName: string): boolean {
    const control = this.formGroup().get(controlName);
    return !!(control?.hasError(errorName) && control.touched);
  }

  showUnespRoleResetWarning(): boolean {
    return (
      this.isEditMode() && this.isUserVerified() && this.unespRoleWillReset()
    );
  }

  showEnrollmentResetWarning(): boolean {
    return (
      this.isEditMode() && this.isUserVerified() && this.enrollmentWillReset()
    );
  }
}
