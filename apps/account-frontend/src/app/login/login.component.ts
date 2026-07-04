import { ChangeDetectionStrategy, Component, PLATFORM_ID, inject, signal } from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../shared/services/auth/auth.service';

@Component({
  selector: 'app-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatButtonModule, MatCardModule, MatFormFieldModule, MatIconModule, MatInputModule],
  template: `
    <main class="login-shell">
      <mat-card class="login-card" appearance="outlined">
        <mat-card-header>
          <mat-card-title>Entrar no CACiC</mat-card-title>
          <mat-card-subtitle>Use seu e-mail e senha.</mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          <form [formGroup]="form" class="login-form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline">
              <mat-label>E-mail</mat-label>
              <input matInput type="email" autocomplete="username" formControlName="email" />
              @if (form.controls.email.hasError('email')) {
                <mat-error>Informe um e-mail válido.</mat-error>
              }
              @if (form.controls.email.hasError('required')) {
                <mat-error>Informe o e-mail.</mat-error>
              }
            </mat-form-field>

            <mat-form-field appearance="outline">
              <mat-label>Senha</mat-label>
              <input
                matInput
                [type]="hidePassword() ? 'password' : 'text'"
                autocomplete="current-password"
                formControlName="password" />
              <button
                mat-icon-button
                matSuffix
                type="button"
                [attr.aria-label]="hidePassword() ? 'Mostrar senha' : 'Ocultar senha'"
                (click)="hidePassword.set(!hidePassword())">
                <mat-icon>
                  {{ hidePassword() ? 'visibility' : 'visibility_off' }}
                </mat-icon>
              </button>
              @if (form.controls.password.hasError('required')) {
                <mat-error>Informe a senha.</mat-error>
              }
            </mat-form-field>

            @if (errorMessage()) {
              <p class="error-message" role="alert">
                {{ errorMessage() }}
              </p>
            }

            <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || isSubmitting()">
              <mat-icon>login</mat-icon>
              {{ isSubmitting() ? 'Entrando...' : 'Entrar' }}
            </button>

            <button mat-button type="button" [disabled]="isSubmitting()" (click)="loginWithSso()">
              <mat-icon>account_circle</mat-icon>
              Entrar com SSO
            </button>
          </form>
        </mat-card-content>
      </mat-card>
    </main>
  `,
  styles: [
    `
      .login-shell {
        min-height: 100vh;
        display: grid;
        place-items: center;
        padding: 24px;
        background: var(--mat-sys-surface-container-low);
      }

      .login-card {
        width: min(100%, 420px);
        border-radius: 8px;
      }

      mat-card-header {
        padding: 24px 24px 8px;
      }

      mat-card-content {
        padding: 16px 24px 24px;
      }

      .login-form {
        display: grid;
        gap: 16px;
      }

      .login-form > button {
        min-height: 44px;
      }

      .error-message {
        margin: 0;
        padding: 12px;
        border-radius: 8px;
        color: var(--mat-sys-error);
        background: var(--mat-sys-error-container);
      }
    `,
  ],
})
export class LoginComponent {
  private readonly authService = inject(AuthService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly hidePassword = signal(true);
  protected readonly isSubmitting = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly form = this.formBuilder.nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required]],
  });

  constructor() {
    if (this.route.snapshot.queryParamMap.get('error') === 'auth_failed') {
      this.errorMessage.set('Não foi possível entrar. Tente novamente.');
    }

    if (this.authService.isAuthenticated()) {
      void this.router.navigateByUrl(this.authService.isOnboarded() ? '/applications' : '/onboarding');
    }
  }

  protected submit(): void {
    if (this.form.invalid || this.isSubmitting()) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    this.errorMessage.set(null);

    const { email, password } = this.form.getRawValue();
    this.authService.passwordLogin(email, password, this.returnTo()).subscribe({
      next: (result) => {
        this.isSubmitting.set(false);
        this.navigateTo(result.redirectUrl);
      },
      error: () => {
        this.isSubmitting.set(false);
        this.errorMessage.set('E-mail ou senha inválidos.');
      },
    });
  }

  protected loginWithSso(): void {
    this.authService.login(this.returnTo());
  }

  private returnTo(): string | undefined {
    return this.route.snapshot.queryParamMap.get('returnTo') ?? undefined;
  }

  private navigateTo(url: string): void {
    if (!this.isBrowser) {
      return;
    }

    window.location.assign(url);
  }
}
