import { Component, inject } from '@angular/core';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { AuthService } from '../shared/services/auth/auth.service';

@Component({
  selector: 'app-login',
  imports: [MatCardModule, MatButtonModule, MatIconModule],
  template: `
    <div class="login-container">
      <mat-card class="login-card">
        <mat-card-header>
          <mat-card-title> do CACiC</mat-card-title>
        </mat-card-header>

        <mat-card-content>
          <div class="login-content">
            <mat-icon class="login-icon">account_circle</mat-icon>
            <p>
              Se você possui vínculo com a Unesp, use seu e-mail institucional
              para fazer login.
            </p>

            @if (errorMessage) {
              <div class="error-message">
                {{ errorMessage }}
              </div>
            }
          </div>
        </mat-card-content>

        <mat-card-actions>
          <div class="actions-center">
            <button
              mat-raised-button
              color="primary"
              (click)="login()"
              class="login-button"
            >
              <mat-icon>login</mat-icon>
              Entrar com o Google
            </button>
          </div>
        </mat-card-actions>
      </mat-card>
    </div>
  `,
  styles: [
    `
      .login-container {
        display: flex;
        justify-content: center;
        align-items: center;
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        padding: 20px;
      }

      .login-card {
        max-width: 400px;
        width: 100%;
        text-align: center;
      }

      .login-content {
        padding: 20px 0;
      }

      .login-icon {
        font-size: 64px;
        width: 64px;
        height: 64px;
        margin-bottom: 20px;
        color: #666;
      }

      .login-button {
        width: 100%;
        height: 48px;
        font-size: 16px;
      }

      .actions-center {
        display: flex;
        justify-content: center;
        width: 100%;
      }

      .error-message {
        background: #ffebee;
        color: #c62828;
        padding: 12px;
        border-radius: 4px;
        margin: 16px 0;
        border: 1px solid #e57373;
      }

      mat-card-title {
        text-align: center;
        margin-bottom: 8px;
      }

      mat-card-subtitle {
        text-align: center;
        color: #666;
      }
    `,
  ],
})
export class LoginComponent {
  private authService = inject(AuthService);
  private router = inject(Router);

  errorMessage = '';

  constructor() {
    // Check URL parameters for error messages
    const urlParams = new URLSearchParams(window.location.search);
    const error = urlParams.get('error');

    if (error === 'auth_failed') {
      this.errorMessage = 'Authentication failed. Please try again.';
    }

    // If user is already authenticated, redirect them
    if (this.authService.isAuthenticated()) {
      if (this.authService.isOnboarded()) {
        this.router.navigateByUrl('/applications');
      } else {
        this.router.navigateByUrl('/onboarding');
      }
    }
  }

  login(): void {
    this.authService.login();
  }
}
