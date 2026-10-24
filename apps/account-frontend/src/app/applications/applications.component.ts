import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, OnInit, signal } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatMenuModule } from '@angular/material/menu';
import { MatIcon } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { RouterLink } from '@angular/router';
import type { Application } from '@cacic/shared-types';
import { AppCardComponent } from './component/app-card/app-card.component';
import { AuthService } from '../shared/services/auth/auth.service';
import { ApiService } from '../shared/services/api.service';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import { DiscordIntegrationCardComponent } from '../settings/linked-accounts/components/discord-integration-card.component';
import { LoggerService } from '../shared/services/logger.service';
import { getApiErrorMessage } from '../shared/utils/api-error-message';

@Component({
  selector: 'app-applications',
  imports: [
    MatMenuModule,
    MatIcon,
    MatProgressBarModule,
    AppCardComponent,
    RouterLink,
    NgOptimizedImage,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    CacicLogoComponent,
    DiscordIntegrationCardComponent,
  ],
  templateUrl: './applications.component.html',
  styleUrl: './applications.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ApplicationsComponent implements OnInit {
  readonly authService = inject(AuthService);
  private readonly apiService = inject(ApiService);
  private readonly logger = inject(LoggerService);
  private readonly destroyRef = inject(DestroyRef);

  readonly currentUser = this.authService.currentUser;
  readonly applications = signal<Application[]>([]);
  readonly isLoading = signal(true);
  readonly hasLoadError = signal(false);
  readonly loadErrorMessage = signal('');
  readonly searchTerm = signal('');
  readonly pictureFailed = signal(false);
  readonly isAdmin = computed(() => this.currentUser()?.isAdmin ?? false);
  readonly userDisplayName = computed(() => {
    const user = this.currentUser();
    return user?.displayName || user?.fullname || user?.email || 'Minha conta';
  });
  readonly userShortName = computed(() => this.userDisplayName().trim().split(/\s+/)[0]);
  readonly userInitials = computed(() => {
    const names = this.userDisplayName().trim().split(/\s+/);
    const first = Array.from(names[0] ?? '')[0] ?? '';
    const last = names.length > 1 ? (Array.from(names[names.length - 1])[0] ?? '') : '';
    return `${first}${last}`.toLocaleUpperCase('pt-BR');
  });
  readonly filteredApplications = computed(() => {
    const query = this.normalize(this.searchTerm().trim());
    return this.applications().filter((app) => this.normalize(`${app.name} ${app.description ?? ''}`).includes(query));
  });

  ngOnInit(): void {
    this.loadApplications();
  }

  loadApplications(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);
    this.apiService
      .getApplicationsFresh()
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: (apps) => {
          this.applications.set(apps);
          this.isLoading.set(false);
        },
        error: (error: unknown) => {
          this.logger.error('Error loading applications', error);
          this.loadErrorMessage.set(
            getApiErrorMessage(error, 'Tente atualizar a lista novamente em alguns instantes.'),
          );
          this.hasLoadError.set(true);
          this.isLoading.set(false);
        },
      });
  }

  private normalize(value: string): string {
    return value
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLocaleLowerCase('pt-BR');
  }
}
