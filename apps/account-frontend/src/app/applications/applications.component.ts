import { Component, inject, computed, signal, OnInit } from '@angular/core';
import { MatToolbar } from '@angular/material/toolbar';
import { MatMenuModule } from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { MatDividerModule } from '@angular/material/divider';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatDialog } from '@angular/material/dialog';
import { AppCardComponent } from './component/app-card/app-card.component';
import { RouterLink } from '@angular/router';
import { AuthService } from '../shared/services/auth/auth.service';
import { ApiService } from '../shared/services/api.service';
import type { Application } from '@cacic/shared-types';
import { catchError, of } from 'rxjs';
import { NgOptimizedImage } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import { DiscordIntegrationCardComponent } from '../settings/linked-accounts/components/discord-integration-card.component';
import { AlphaInfoDialogComponent } from './components/alpha-info-dialog/alpha-info-dialog.component';
import { LoggerService } from '../shared/services/logger.service';

@Component({
  selector: 'app-applications',
  imports: [
    MatToolbar,
    MatMenuModule,
    MatIcon,
    MatDividerModule,
    MatProgressSpinnerModule,
    AppCardComponent,
    RouterLink,
    NgOptimizedImage,
    MatButtonModule,
    CacicLogoComponent,
    DiscordIntegrationCardComponent,
  ],
  templateUrl: './applications.component.html',
  styleUrl: './applications.component.scss',
  providers: [AppCardComponent],
})
export class ApplicationsComponent implements OnInit {
  authService = inject(AuthService);
  apiService = inject(ApiService);
  dialog = inject(MatDialog);
  private logger = inject(LoggerService);

  // Use signals for reactive user data
  currentUser = computed(() => this.authService.currentUser());
  applications = signal<Application[]>([]);
  isLoading = signal(false);
  searchTerm = '';

  // Computed property for admin status from user data
  isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);

  ngOnInit(): void {
    this.loadApplications();
  }

  private loadApplications(): void {
    this.isLoading.set(true);
    this.apiService
      .getApplications()
      .pipe(
        catchError((error) => {
          this.logger.error('Error loading applications', error);
          return of([]);
        }),
      )
      .subscribe({
        next: (apps) => {
          this.applications.set(apps);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        },
      });
  }

  // computed property for user display name
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

  openAlphaInfo() {
    this.dialog.open(AlphaInfoDialogComponent, {
      width: '600px',
      maxWidth: '90vw',
      panelClass: 'alpha-info-dialog',
    });
  }
}
