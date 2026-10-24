import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { DiscordAdminComponent } from './components/discord-admin.component';
import { DiscordRoleAdminComponent } from './components/discord-role-admin.component';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth/auth.service';
import { RouterLink } from '@angular/router';
import { LoggerService } from '../../shared/services/logger.service';
import { getApiErrorMessage } from '../../shared/utils/api-error-message';

@Component({
  selector: 'app-discord-integration',
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    DiscordAdminComponent,
    DiscordRoleAdminComponent,
    RouterLink,
  ],
  templateUrl: './discord-integration.component.html',
  styleUrl: './discord-integration.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordIntegrationComponent implements OnInit {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);

  // Get authentication status
  isAuthenticated = this.authService.isAuthenticated;

  // Discord admin status
  isDiscordAdmin = signal<boolean>(false);
  isCheckingAdmin = signal<boolean>(true);
  adminStatusError = signal<string | null>(null);

  ngOnInit(): void {
    // Check Discord admin status
    this.checkDiscordAdminStatus();
  }

  protected retryAdminStatusCheck(): void {
    this.checkDiscordAdminStatus();
  }

  private checkDiscordAdminStatus(): void {
    // Only check if user is authenticated
    if (!this.isAuthenticated()) {
      this.isDiscordAdmin.set(false);
      this.isCheckingAdmin.set(false);
      return;
    }

    this.isCheckingAdmin.set(true);
    this.adminStatusError.set(null);
    this.apiService.getDiscordAdminStatus().subscribe({
      next: (response) => {
        this.isDiscordAdmin.set(response.isAdmin);
        this.adminStatusError.set(null);
        this.isCheckingAdmin.set(false);
      },
      error: (error) => {
        this.logger.error('Error checking Discord admin status', error);
        this.adminStatusError.set(
          getApiErrorMessage(
            error,
            'Não foi possível verificar se sua conta tem acesso administrativo ao Discord. Tente novamente em instantes.',
          ),
        );
        this.isCheckingAdmin.set(false);
      },
    });
  }
}
