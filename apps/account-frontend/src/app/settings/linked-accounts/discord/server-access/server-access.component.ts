import { ChangeDetectionStrategy, Component, computed, inject, signal, OnInit } from '@angular/core';

import { RouterModule } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatToolbarModule } from '@angular/material/toolbar';
import { NgOptimizedImage } from '@angular/common';
import { ApiService, DiscordLinkStatus } from '../../../../shared/services/api.service';
import { LoggerService } from '../../../../shared/services/logger.service';

@Component({
  selector: 'app-discord-server-access',
  imports: [RouterModule, NgOptimizedImage, MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatToolbarModule],
  templateUrl: './server-access.component.html',
  styleUrl: './server-access.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordServerAccessComponent implements OnInit {
  private apiService = inject(ApiService);
  private logger = inject(LoggerService);

  isLoading = signal(true);
  discordStatus = signal<DiscordLinkStatus | null>(null);
  hasLoadError = signal(false);

  protected readonly accessLabel = computed(() => {
    const role = this.discordStatus()?.eligibleForRole;
    return role === 'student' ? 'Estudante do BCC' : role === 'unesp' ? 'Unespiano' : 'Visitante';
  });

  ngOnInit(): void {
    this.loadDiscordStatus();
  }

  private loadDiscordStatus(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);

    this.apiService.getDiscordLinkStatusFresh().subscribe({
      next: (status) => {
        this.discordStatus.set(status);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.logger.error('Error loading Discord status', error, { operation: 'discord-status' });
        this.hasLoadError.set(true);
        this.isLoading.set(false);
      },
    });
  }

  hasVisitorRole(): boolean {
    return this.discordStatus()?.discordLinks?.some((link) => link.assignedRole === 'visitor') || false;
  }

  retryLoading(): void {
    this.loadDiscordStatus();
  }
}
