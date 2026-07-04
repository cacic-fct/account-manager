import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';

interface CountryCodeOptionView {
  iso2: string;
  label: string;
  dialCode: string;
}

interface CountryOptionView {
  iso2: string;
  label: string;
}

@Component({
  selector: 'app-profile-form-personal-step',
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    MatCheckboxModule,
    MatSelectModule,
    MatCardModule,
  ],
  templateUrl: './profile-form-personal-step.component.html',
  styleUrl: './profile-form-personal-step.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileFormPersonalStepComponent {
  formGroup = input.required<FormGroup>();
  isUnespUser = input<boolean>(false);
  fullNameLocked = input<boolean>(false);
  identityDocumentLocked = input<boolean>(false);
  countryCodeOptions = input<CountryCodeOptionView[]>([]);

  resolvedPassportCountryOptions = computed(() => {
    return this.countryCodeOptions()
      .map(({ iso2, label }) => ({
        iso2,
        label,
      }))
      .filter((option) => option.iso2 !== 'BR');
  });

  phoneInput = output<void>();
  phoneBlur = output<void>();

  hasError(controlName: string, errorName: string): boolean {
    const control = this.formGroup().get(controlName);
    return !!(control?.hasError(errorName) && control.touched);
  }

  isForeigner(): boolean {
    return !!this.formGroup().get('isForeigner')?.value;
  }

  getIdentityDocumentLabel(): string {
    return this.formGroup().get('isForeigner')?.value ? 'Número do passaporte' : 'CPF';
  }
}
