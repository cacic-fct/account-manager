import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  OnInit,
  output,
  signal,
} from '@angular/core';
import {
  AbstractControl,
  FormBuilder,
  FormGroup,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatStepperModule } from '@angular/material/stepper';
import { firstValueFrom } from 'rxjs';
import { AuthService } from '../../services/auth/auth.service';
import { PhoneValidationService } from '../../services/phone-validation.service';
import { ApiService } from '../../services/api.service';
import type { CreateUserProfile, User } from '@cacic/shared-types';
import {
  UnespRole,
  getUnespRoleOptions,
  isStudentRole,
} from '@cacic/shared-types';
import { VerificationResetConfirmDialogComponent } from './verification-reset-confirm-dialog.component';
import { ConfirmationDialogComponent } from '../confirmation-dialog.component';
import {
  CountryCode,
  getCountries,
  getCountryCallingCode,
  isSupportedCountry,
  parsePhoneNumberFromString,
} from 'libphonenumber-js/max';
import { LoggerService } from '../../services/logger.service';
import { isUnespEmail } from '@cacic/shared-utils';
import { ProfileFormPersonalStepComponent } from './profile-form-personal-step.component';
import { ProfileFormAcademicStepComponent } from './profile-form-academic-step.component';

export interface ProfileFormData {
  fullname: string;
  phone: string;
  countryCode?: string;
  passportCountry?: string;
  enrollmentNumber?: string;
  identityDocument: string;
  isForeigner: boolean;
  unespRole?: UnespRole;
  willResetVerification?: boolean; // Indicates if these changes will reset verification
}

interface CountryCodeOption {
  iso2: string;
  label: string;
  dialCode: string;
}

interface CountryOption {
  iso2: string;
  label: string;
}

interface ProfileFormSnapshot {
  personal: {
    fullname: string;
    countryCode: string;
    passportCountry: string;
    phone: string;
    identityDocument: string;
    isForeigner: boolean;
  };
  academic: {
    unespRole: string;
    enrollmentNumber: string;
  };
}

interface IdentityFieldLocks {
  fullName: boolean;
  identityDocument: boolean;
}

@Component({
  selector: 'app-profile-form',
  imports: [
    MatStepperModule,
    MatButtonModule,
    MatIconModule,
    ProfileFormPersonalStepComponent,
    ProfileFormAcademicStepComponent,
  ],
  templateUrl: './profile-form.component.html',
  styleUrl: './profile-form.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProfileFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private authService = inject(AuthService);
  private phoneValidationService = inject(PhoneValidationService);
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private fixedLineDialogShownFor = '';
  private logger = inject(LoggerService);

  constructor() {
    effect(() => {
      this.identityFieldLocks();
      this.applyIdentityFieldLocks();
    });
  }

  // Inputs
  initialData = input<Partial<ProfileFormData>>({});
  identityFieldLocks = input<IdentityFieldLocks>({
    fullName: false,
    identityDocument: false,
  });
  isEditMode = input<boolean>(false);
  layoutMode = input<'stepper' | 'all-in-one'>('stepper');

  // Outputs
  formValid = output<boolean>();
  formData = output<ProfileFormData>();
  formChange = output<Partial<ProfileFormData>>();
  saveSuccess = output<User>();
  saveError = output<unknown>();
  savingChange = output<boolean>();

  // Signals
  shouldShowUnespRoleSelection = signal(false);
  unespRoleValue = signal<string>('');
  countryCodeValue = signal<string>('BR');
  isSubmitting = signal(false);
  unespRoleOptions = getUnespRoleOptions();
  countryCodeOptions: CountryCodeOption[] = this.buildCountryCodeOptions();

  // Track initial values for verification reset checking
  private initialUnespRole: UnespRole | undefined;
  private initialEnrollmentNumber: string | undefined;

  // Computed properties for template access
  isUserVerified = computed(() => {
    const currentUser = this.authService.currentUser();
    return currentUser?.unespRoleVerified ?? false;
  });

  profileForm: FormGroup = this.fb.group({
    personal: this.fb.group({
      fullname: ['', [Validators.required, Validators.minLength(2)]],
      countryCode: ['BR', Validators.required],
      passportCountry: ['BR'],
      phone: ['', [Validators.required, this.phoneValidator.bind(this)]],
      identityDocument: [
        '',
        [Validators.required, this.identityDocumentValidator.bind(this)],
      ],
      isForeigner: [false],
    }),
    academic: this.fb.group({
      unespRole: [''],
      enrollmentNumber: [''],
    }),
  });

  get personalGroup(): FormGroup {
    return this.profileForm.get('personal') as FormGroup;
  }

  get academicGroup(): FormGroup {
    return this.profileForm.get('academic') as FormGroup;
  }

  // Computed properties
  showEnrollmentNumber = computed(() => {
    const unespRole = this.unespRoleValue();
    return (
      !!unespRole && isStudentRole(unespRole as UnespRole) && this.isUnespUser()
    );
  });

  isEnrollmentNumberRequired = computed(() => {
    const unespRole = this.unespRoleValue();
    return !!unespRole && isStudentRole(unespRole as UnespRole);
  });

  isUnespUser = computed(() => {
    const currentUser = this.authService.currentUser();
    return isUnespEmail(currentUser?.email);
  });

  isStepperLayout = computed(() => this.layoutMode() === 'stepper');

  isAllInOneLayout = computed(() => this.layoutMode() === 'all-in-one');

  ngOnInit(): void {
    this.initializeForm();
    this.setupFormWatchers();
    this.loadUnespRoleRequirement();
  }

  private initializeForm(): void {
    // Pre-fill form with initial data or current user data
    const currentUser = this.authService.currentUser();
    const initial = this.initialData();

    const rawPhone = initial.phone || currentUser?.phone || '';
    const phoneParseResult = this.phoneValidationService.parsePhoneValue(
      rawPhone,
      initial.countryCode || 'BR',
    );

    const formData: ProfileFormSnapshot = {
      personal: {
        fullname:
          initial.fullname ||
          currentUser?.fullname ||
          currentUser?.displayName ||
          '',
        phone: this.phoneValidationService.formatToNational(
          phoneParseResult.nationalNumber || '',
          phoneParseResult.country || 'BR',
        ),
        passportCountry: initial.passportCountry || '',
        isForeigner: initial.isForeigner ?? currentUser?.isForeigner ?? false,
        identityDocument:
          initial.identityDocument || currentUser?.identityDocument || '',
        countryCode: phoneParseResult.country || '',
      },
      academic: {
        enrollmentNumber:
          initial.enrollmentNumber || currentUser?.enrollmentNumber || '',
        unespRole: initial.unespRole || currentUser?.unespRole || '',
      },
    };

    this.profileForm.patchValue(formData);

    // Initialize the signals with current values
    this.countryCodeValue.set(formData.personal.countryCode || '');
    this.unespRoleValue.set(formData.academic.unespRole || '');

    // Store initial values for verification reset checking
    this.initialUnespRole = currentUser?.unespRole;
    this.initialEnrollmentNumber = currentUser?.enrollmentNumber;

    this.applyIdentityFieldLocks();
  }

  private applyIdentityFieldLocks(): void {
    const currentUser = this.authService.currentUser();
    const locks = this.identityFieldLocks();

    const fullnameControl = this.personalGroup.get('fullname');
    if (locks.fullName || isUnespEmail(currentUser?.email)) {
      fullnameControl?.disable();
    } else {
      fullnameControl?.enable();
    }

    const identityDocumentControl = this.personalGroup.get('identityDocument');
    const isForeignerControl = this.personalGroup.get('isForeigner');

    if (locks.identityDocument) {
      identityDocumentControl?.disable();
      isForeignerControl?.disable();
    } else {
      identityDocumentControl?.enable();
      isForeignerControl?.enable();
    }
  }

  private setupFormWatchers(): void {
    // Watch form changes
    this.profileForm.valueChanges.subscribe(() => {
      this.emitFormState();
    });

    // Watch isForeigner changes to update identity document validation
    this.personalGroup.get('isForeigner')?.valueChanges.subscribe(() => {
      this.personalGroup.get('identityDocument')?.updateValueAndValidity();
      this.updatePassportCountryRules();

      if (!this.personalGroup.get('isForeigner')?.value) {
        this.personalGroup
          .get('passportCountry')
          ?.setValue('BR', { emitEvent: false });
      }
    });

    // Watch country code changes so validation and formatted output use the selected region
    this.personalGroup
      .get('countryCode')
      ?.valueChanges.subscribe((countryCode: string | null) => {
        const currentCountry = countryCode || 'BR';
        this.countryCodeValue.set(currentCountry);

        const phoneControl = this.personalGroup.get('phone');
        const currentValue = phoneControl?.value || '';
        const formattedValue = this.phoneValidationService.formatToNational(
          currentValue,
          currentCountry,
        );

        if (formattedValue !== currentValue) {
          phoneControl?.setValue(formattedValue, { emitEvent: false });
        }

        this.personalGroup.get('phone')?.updateValueAndValidity();
      });

    // Watch unespRole changes to update enrollment number validation and signal
    this.academicGroup
      .get('unespRole')
      ?.valueChanges.subscribe((role: string | null) => {
        const roleValue = role || '';
        this.applyEnrollmentRules(roleValue);
      });

    this.applyEnrollmentRules(
      this.academicGroup.get('unespRole')?.value?.toString() || '',
    );
    this.updatePassportCountryRules();

    // Initial emission
    setTimeout(() => {
      this.emitFormState();
    });
  }

  private loadUnespRoleRequirement(): void {
    this.apiService.checkUnespRoleRequired().subscribe({
      next: (response) => {
        this.shouldShowUnespRoleSelection.set(
          response.shouldShowUnespRoleSelection,
        );
      },
      error: (error) => {
        this.logger.error('Error checking Unesp role requirement', error);
      },
    });
  }

  getFormData(): ProfileFormData {
    const currentUser = this.authService.currentUser();
    const isUnespUser = isUnespEmail(currentUser?.email);
    const snapshot = this.getFormSnapshot();
    const personal = snapshot.personal;
    const academic = snapshot.academic;

    const fullname = isUnespUser
      ? currentUser?.fullname || currentUser?.displayName || ''
      : personal.fullname;

    const phone = this.phoneValidationService.formatToInternational(
      personal.phone,
      personal.countryCode || 'BR',
    );

    const unespRole = academic.unespRole
      ? (academic.unespRole as UnespRole)
      : undefined;
    const enrollmentNumber =
      unespRole && isStudentRole(unespRole)
        ? academic.enrollmentNumber || undefined
        : undefined;
    const passportCountry = personal.isForeigner
      ? personal.passportCountry || 'BR'
      : undefined;

    const data: ProfileFormData = {
      fullname,
      countryCode: personal.countryCode || 'BR',
      passportCountry,
      phone,
      enrollmentNumber,
      identityDocument: personal.identityDocument,
      isForeigner: personal.isForeigner,
      unespRole,
      willResetVerification: this.hasVerificationSensitiveChanges({
        fullname,
        countryCode: personal.countryCode || 'BR',
        phone,
        enrollmentNumber,
        identityDocument: personal.identityDocument,
        isForeigner: personal.isForeigner,
        unespRole,
      }),
    };

    return data;
  }

  phoneValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;

    const countryCode =
      this.personalGroup.get('countryCode')?.value || this.countryCodeValue();
    const isValid = this.phoneValidationService.isValidInternationalPhone(
      control.value,
      countryCode,
    );
    return isValid ? null : { invalidPhone: true };
  }

  onPhoneBlur(): void {
    this.logger.debug('Phone input blurred, checking for fixed line warning');
    this.maybeShowFixedLineWarning();
  }

  private maybeShowFixedLineWarning(): void {
    const countryCode =
      this.personalGroup.get('countryCode')?.value || this.countryCodeValue();
    const phoneValue = this.personalGroup
      .get('phone')
      ?.value?.toString()
      .trim();

    if (!phoneValue) {
      this.logger.debug('No phone number entered, skipping fixed line check');
      return;
    }

    const normalizedCountry = (
      isSupportedCountry(countryCode) ? countryCode : 'BR'
    ) as CountryCode;

    const parsed = parsePhoneNumberFromString(phoneValue, normalizedCountry);

    if (!parsed?.isValid()) {
      this.logger.debug(
        'Invalid phone number entered, skipping fixed line check',
        {
          phoneValue,
          countryCode,
        },
      );
      return;
    }

    if (parsed.getType() !== 'FIXED_LINE') {
      this.logger.debug('Phone number is not fixed line, no warning needed', {
        phoneValue,
        countryCode,
        parsed,
        phoneType: parsed.getType(),
      });
      return;
    }

    if (this.fixedLineDialogShownFor === parsed.number) {
      this.logger.debug(
        'Fixed line warning already shown for this number, skipping dialog',
        {
          phoneValue,
          countryCode,
        },
      );
      return;
    }

    this.fixedLineDialogShownFor = parsed.number;

    this.dialog.open(ConfirmationDialogComponent, {
      width: '500px',
      data: {
        title: 'Número fixo detectado',
        message: `Tem certeza que deseja incluir um número fixo?\n\n${parsed.nationalNumber}\n\nAo inserir um número que não possui WhatsApp, pode ser que não entremos em contato!`,
        confirmText: 'Entendi',
        cancelText: 'Cancelar',
      },
      disableClose: false,
    });
  }

  identityDocumentValidator(control: AbstractControl): ValidationErrors | null {
    if (!control.value) return null;

    const isForeigner = this.personalGroup.get('isForeigner')?.value;
    if (!isForeigner) {
      const isValidCPF = this.phoneValidationService.isValidCPF(control.value);
      return isValidCPF ? null : { invalidCPF: true };
    }

    return null; // For passport, just check if not empty (handled by required validator)
  }

  passportCountryValidator(control: AbstractControl): ValidationErrors | null {
    const isForeigner = !!this.personalGroup.get('isForeigner')?.value;

    if (!isForeigner) {
      return null;
    }

    if (!control.value || control.value.toString().trim() === '') {
      return { required: true };
    }

    return null;
  }

  formatPhoneInput(): void {
    const countryCode =
      this.personalGroup.get('countryCode')?.value || this.countryCodeValue();
    const phoneControl = this.personalGroup.get('phone');
    const currentValue = phoneControl?.value || '';
    const formattedValue = this.phoneValidationService.formatToNational(
      currentValue,
      countryCode,
    );

    if (formattedValue !== currentValue) {
      phoneControl?.setValue(formattedValue, { emitEvent: false });
    }

    this.emitFormState();
  }

  async submitProfile(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }

    const submissionResult = await this.handleFormSubmission();

    if (!submissionResult.proceed || !submissionResult.data) {
      return;
    }

    const formData = submissionResult.data;
    const profileData: CreateUserProfile = {
      fullname: formData.fullname,
      phone: formData.phone,
      enrollmentNumber: formData.enrollmentNumber,
      identityDocument: formData.identityDocument,
      isForeigner: formData.isForeigner,
      unespRole: formData.unespRole,
    };

    this.isSubmitting.set(true);
    this.savingChange.emit(true);

    try {
      const updatedUser = await firstValueFrom(
        this.apiService.updateProfile(profileData),
      );

      this.authService.updateCurrentUser(updatedUser);
      this.saveSuccess.emit(updatedUser);
    } catch (error) {
      this.logger.error('Error updating profile', error);
      this.saveError.emit(error);
    } finally {
      this.isSubmitting.set(false);
      this.savingChange.emit(false);
    }
  }

  // Public method to mark all fields as touched (for validation display)
  markAllAsTouched(): void {
    this.profileForm.markAllAsTouched();
  }

  // Public method to check if form is valid
  isValid(): boolean {
    return this.profileForm.valid;
  }

  // Public method to get form validity
  get valid(): boolean {
    return this.profileForm.valid;
  }

  /**
   * Public method to handle form submission with verification reset confirmation
   * Should be called by parent components before submitting the form
   */
  async handleFormSubmission(): Promise<{
    proceed: boolean;
    data?: ProfileFormData;
  }> {
    // First check if form is valid
    if (!this.profileForm.valid) {
      this.markAllAsTouched();
      return { proceed: false };
    }

    // Check if changes require verification reset confirmation
    const canProceed = await this.checkVerificationReset();

    if (canProceed) {
      return {
        proceed: true,
        data: this.getFormData(),
      };
    }

    return { proceed: false };
  }

  /**
   * Check if changes will reset verification status and show confirmation if needed
   */
  async checkVerificationReset(): Promise<boolean> {
    // Only check in edit mode for verified users
    if (!this.isEditMode() || !this.isUserVerified()) {
      return true;
    }

    const currentFormData = this.getFormData();
    const hasVerificationSensitiveChanges =
      this.hasVerificationSensitiveChanges(currentFormData);

    if (hasVerificationSensitiveChanges) {
      const dialogRef = this.dialog.open(
        VerificationResetConfirmDialogComponent,
        {
          width: '500px',
          disableClose: true,
        },
      );

      const confirmed = await firstValueFrom(dialogRef.afterClosed());
      return confirmed === true;
    }

    return true;
  }

  /**
   * Check if a specific field change will reset verification
   * Used for showing warnings in the template
   */
  willResetVerification(fieldName: string): boolean {
    if (!this.isEditMode() || !this.isUserVerified()) {
      return false;
    }

    const controlPath =
      fieldName === 'unespRole'
        ? 'academic.unespRole'
        : fieldName === 'enrollmentNumber'
          ? 'academic.enrollmentNumber'
          : fieldName;

    const currentValue = this.profileForm.get(controlPath)?.value;

    switch (fieldName) {
      case 'unespRole':
        return this.initialUnespRole !== currentValue;
      case 'enrollmentNumber':
        return this.initialEnrollmentNumber !== currentValue;
      default:
        return false;
    }
  }

  /**
   * Check if the form changes include verification-sensitive fields
   */
  private hasVerificationSensitiveChanges(
    currentData: ProfileFormData,
  ): boolean {
    const enrollmentChanged =
      this.initialEnrollmentNumber !== currentData.enrollmentNumber;
    const unespRoleChanged = this.initialUnespRole !== currentData.unespRole;

    return enrollmentChanged || unespRoleChanged;
  }

  private emitFormState(): void {
    this.formValid.emit(this.profileForm.valid);
    this.formData.emit(this.getFormData());
    this.formChange.emit(this.getFlatFormValue());
  }

  private getFlatFormValue(): Partial<ProfileFormData> {
    const snapshot = this.getFormSnapshot();
    return {
      fullname: snapshot.personal.fullname,
      countryCode: snapshot.personal.countryCode,
      passportCountry: snapshot.personal.isForeigner
        ? snapshot.personal.passportCountry
        : undefined,
      phone: snapshot.personal.phone,
      identityDocument: snapshot.personal.identityDocument,
      isForeigner: snapshot.personal.isForeigner,
      enrollmentNumber:
        snapshot.academic.unespRole &&
        isStudentRole(snapshot.academic.unespRole as UnespRole)
          ? snapshot.academic.enrollmentNumber || undefined
          : undefined,
      unespRole: snapshot.academic.unespRole
        ? (snapshot.academic.unespRole as UnespRole)
        : undefined,
    };
  }

  private getFormSnapshot(): ProfileFormSnapshot {
    const raw = this.profileForm.getRawValue() as ProfileFormSnapshot;

    return {
      personal: {
        fullname: raw.personal?.fullname || '',
        countryCode: raw.personal?.countryCode || 'BR',
        passportCountry: raw.personal?.passportCountry || 'BR',
        phone: raw.personal?.phone || '',
        identityDocument: raw.personal?.identityDocument || '',
        isForeigner: raw.personal?.isForeigner ?? false,
      },
      academic: {
        unespRole: raw.academic?.unespRole || '',
        enrollmentNumber: raw.academic?.enrollmentNumber || '',
      },
    };
  }

  private buildCountryCodeOptions(): CountryCodeOption[] {
    const displayNames = new Intl.DisplayNames(['pt-BR'], {
      type: 'region',
    });

    return getCountries()
      .map((iso2) => ({
        iso2,
        label: displayNames.of(iso2) ?? iso2,
        dialCode: `+${getCountryCallingCode(iso2)}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private buildCountryOptions(): CountryOption[] {
    const displayNames = new Intl.DisplayNames(['pt-BR'], {
      type: 'region',
    });

    return getCountries()
      .map((iso2) => ({
        iso2,
        label: displayNames.of(iso2) ?? iso2,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  private applyEnrollmentRules(roleValue: string): void {
    this.unespRoleValue.set(roleValue);

    const enrollmentControl = this.academicGroup.get('enrollmentNumber');
    const isRequired = !!roleValue && isStudentRole(roleValue as UnespRole);

    if (isRequired) {
      enrollmentControl?.setValidators([Validators.required]);
    } else {
      enrollmentControl?.clearValidators();
      enrollmentControl?.setValue('', { emitEvent: false });
    }

    enrollmentControl?.updateValueAndValidity({ emitEvent: false });
  }

  private updatePassportCountryRules(): void {
    const passportCountryControl = this.personalGroup.get('passportCountry');
    const isForeigner = !!this.personalGroup.get('isForeigner')?.value;

    if (isForeigner) {
      passportCountryControl?.setValidators([
        Validators.required,
        this.passportCountryValidator.bind(this),
      ]);

      if (!passportCountryControl?.value) {
        passportCountryControl?.setValue('BR', { emitEvent: false });
      }
    } else {
      passportCountryControl?.clearValidators();
      passportCountryControl?.setValue('BR', { emitEvent: false });
    }

    passportCountryControl?.updateValueAndValidity({ emitEvent: false });
  }
}
