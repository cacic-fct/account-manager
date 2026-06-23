import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { NgIf, NgOptimizedImage } from '@angular/common';
import { Router } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatSnackBar } from '@angular/material/snack-bar';
import { firstValueFrom } from 'rxjs';
import { ApiService } from '../shared/services/api.service';
import { AuthService } from '../shared/services/auth/auth.service';
import type { User } from '@cacic/shared-types';
import { ProfileFormComponent } from '../shared/components/profile-form/profile-form.component';
import { LoggerService } from '../shared/services/logger.service';
import { MatToolbarModule } from '@angular/material/toolbar';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import { MatMenu, MatMenuModule } from '@angular/material/menu';
import { MatDivider } from '@angular/material/divider';

@Component({
  selector: 'app-onboarding',
  imports: [
    MatToolbarModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatExpansionModule,
    ProfileFormComponent,
    NgOptimizedImage,
    CacicLogoComponent,
    MatMenuModule,
    MatDivider,
  ],
  templateUrl: './onboarding.component.html',
  styleUrl: './onboarding.component.scss',
})
export class OnboardingComponent implements OnInit {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private snackBar = inject(MatSnackBar);
  private logger = inject(LoggerService);
  currentUser = computed(() => this.authService.currentUser());
  userDisplayName = computed(() => {
    const user = this.currentUser();
    if (user) {
      return user.fullname || user.displayName || user.email;
    }
    return 'User';
  });

  logout() {
    this.authService.logout();
  }

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

  ngOnInit(): void {
    this.logger.debug('OnboardingComponent initialized');

    // Wait for auth service to be fully loaded before proceeding
    this.authService.isDoneLoading$.subscribe((isDone) => {
      if (!isDone) {
        this.logger.debug('Auth service still loading');
        return;
      }

      this.logger.debug('Auth service loaded, proceeding with initialization');
      this.initializeComponent();
    });
  }

  private initializeComponent(): void {
    // Check if user is authenticated
    if (!this.authService.isAuthenticated()) {
      this.logger.warn('User not authenticated, redirecting to login');
      this.router.navigateByUrl('/login');
      return;
    }

    // Check if user is already onboarded before loading form
    if (this.authService.isOnboarded()) {
      this.logger.info('User already onboarded, redirecting to applications');
      this.router.navigateByUrl('/applications');
      return;
    }

    // Load the current user data from cache first, then backend if needed
    this.apiService.getCurrentUser().subscribe({
      next: (currentUser) => {
        this.logger.debug('Loaded current user data from backend');

        // Update auth service with fresh user data
        this.authService.updateCurrentUser(currentUser);

        // Double-check onboarding status after getting fresh data
        if (currentUser.isOnboarded) {
          this.logger.info(
            'User is already onboarded according to backend data, redirecting to applications',
          );
          this.router.navigateByUrl('/applications');
          return;
        }
      },
      error: (error) => {
        this.logger.error('Error loading current user', error);
        // Fallback continues with cached user data from initialFormData computed
      },
    });
  }

  sectionIndex = signal(0);

  get isLastSection(): boolean {
    return this.sectionIndex() === 1;
  }

  get showOnboardingForm(): boolean {
    return this.sectionIndex() > 1;
  }

  continueToNextSection(): void {
    const nextIndex = this.sectionIndex() + 1;
    this.sectionIndex.set(nextIndex);
  }

  async onProfileSaveSuccess(updatedUser: User): Promise<void> {
    this.logger.info('Profile update successful', { userId: updatedUser.id });

    // Refresh auth status to ensure onboarding status is up to date
    await this.authService.refreshAuthStatus();

    this.snackBar.open('Perfil salvo!', 'Close', {
      duration: 3000,
      panelClass: ['success-snackbar'],
    });

    let redirectUrl: string | null = null;
    try {
      const redirectResponse = await firstValueFrom(
        this.apiService.consumePostOnboardingRedirect(),
      );
      redirectUrl = redirectResponse.redirectUrl;
    } catch (consumeRedirectError) {
      this.logger.warn(
        'Unable to consume post-onboarding redirect, falling back to applications',
        consumeRedirectError,
      );
    }

    if (redirectUrl) {
      this.logger.info('Redirecting user after successful onboarding', {
        target: redirectUrl,
      });
      window.location.href = redirectUrl;
      return;
    }

    this.logger.info('Redirecting to applications after successful onboarding');
    this.router.navigateByUrl('/applications');
  }

  onProfileSaveError(error: unknown): void {
    this.logger.error('Profile creation error', error);
    this.snackBar.open('Failed to create profile. Please try again.', 'Close', {
      duration: 5000,
      panelClass: ['error-snackbar'],
    });
  }
}
