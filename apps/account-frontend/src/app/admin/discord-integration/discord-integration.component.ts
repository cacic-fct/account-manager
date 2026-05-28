import { Component, inject, OnInit, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatToolbarModule } from '@angular/material/toolbar';
import { DiscordAdminComponent } from './components/discord-admin.component';
import { DiscordRoleAdminComponent } from './components/discord-role-admin.component';
import { ApiService } from '../../shared/services/api.service';
import { AuthService } from '../../shared/services/auth/auth.service';
import { RouterLink } from '@angular/router';
import { LoggerService } from '../../shared/services/logger.service';

@Component({
  selector: 'app-discord-integration',
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    DiscordAdminComponent,
    DiscordRoleAdminComponent,
    RouterLink,
  ],
  templateUrl: './discord-integration.component.html',
  styleUrl: './discord-integration.component.scss',
})
export class DiscordIntegrationComponent implements OnInit {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private logger = inject(LoggerService);

  // Get authentication status
  isAuthenticated = this.authService.isAuthenticated;

  // Discord admin status
  isDiscordAdmin = signal<boolean>(false);

  ngOnInit(): void {
    // Check Discord admin status
    this.checkDiscordAdminStatus();
  }
  private checkDiscordAdminStatus(): void {
    // Only check if user is authenticated
    if (this.isAuthenticated()) {
      this.apiService.getDiscordAdminStatus().subscribe({
        next: (response) => {
          this.isDiscordAdmin.set(response.isAdmin);
        },
        error: (error) => {
          this.logger.error('Error checking Discord admin status', error);
          this.isDiscordAdmin.set(false);
        },
      });
    }
  }
}
