import { Component, computed, inject } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatButtonModule } from '@angular/material/button';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatDividerModule } from '@angular/material/divider';
import { FormsModule } from '@angular/forms';
import { MatToolbar } from '@angular/material/toolbar';
import { RouterLink } from '@angular/router';
import { AuthService } from '../shared/services/auth/auth.service';

@Component({
  selector: 'app-settings',
  templateUrl: './settings.component.html',
  styleUrls: ['./settings.component.scss'],
  imports: [
    MatIconModule,
    MatListModule,
    MatButtonModule,
    MatSlideToggleModule,
    MatDividerModule,
    FormsModule,
    MatToolbar,
    RouterLink,
  ],
})
export class SettingsComponent {
  private authService = inject(AuthService);

  // Get current user from auth service
  currentUser = this.authService.currentUser;
  isAuthenticated = this.authService.isAuthenticated;

  // Computed property for admin status from user data
  isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  // Computed user display data
  user = computed(() => {
    const current = this.currentUser();
    if (!current) {
      return {
        name: '',
        email: '',
        // TODO: change
        avatarUrl: '', // fallback for loading state
      };
    }

    return {
      name: current.fullname || current.displayName || current.email.split('@')[0],
      email: current.email,
      // TODO: change
      avatarUrl: current.picture || '',
    };
  });

  // Toggle values
  backgroundPlay = true;
  downloadWifiOnly = false;
  autoplay = true;

  // Handle image loading errors by falling back to a default avatar
  onImageError(event: Event): void {
    const img = event.target as HTMLImageElement;
    //  TODO: Replace with a proper placeholder URL
    img.src = '';
  }

  // Handle logout
  logout(): void {
    this.authService.logout();
  }
}
