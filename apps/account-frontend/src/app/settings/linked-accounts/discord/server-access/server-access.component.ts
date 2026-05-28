import { Component, inject, signal, OnInit } from '@angular/core';

import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Location } from '@angular/common';
import {
  ApiService,
  DiscordLinkStatus,
} from '../../../../shared/services/api.service';

@Component({
  selector: 'app-discord-server-access',
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    MatToolbarModule
],
  templateUrl: './server-access.component.html',
  styleUrl: './server-access.component.scss',
})
export class DiscordServerAccessComponent implements OnInit {
  private apiService = inject(ApiService);
  private location = inject(Location);

  isLoading = signal(true);
  discordStatus = signal<DiscordLinkStatus | null>(null);
  hasLoadError = signal(false);

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
        console.error('Error loading Discord status:', error);
        this.hasLoadError.set(true);
        this.isLoading.set(false);
      },
    });
  }

  goBack(): void {
    this.location.back();
  }

  hasVisitorRole(): boolean {
    return (
      this.discordStatus()?.discordLinks?.some(
        (link) => link.assignedRole?.toLowerCase() === 'visitor',
      ) || false
    );
  }

  retryLoading(): void {
    this.loadDiscordStatus();
  }
}
