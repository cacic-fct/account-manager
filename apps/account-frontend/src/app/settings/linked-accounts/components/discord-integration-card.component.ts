import { Component, inject, signal, OnInit, OnDestroy } from '@angular/core';
import {
  MatCard,
  MatCardContent,
  MatCardActions,
} from '@angular/material/card';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import {
  ApiService,
  DiscordLinkStatus,
} from '../../../shared/services/api.service';

@Component({
  selector: 'app-discord-integration-card',
  imports: [
    MatCard,
    MatCardContent,
    MatCardActions,
    MatIconButton,
    MatIcon,
    MatProgressSpinnerModule,
    MatTooltipModule,
    RouterLink,
  ],
  template: `
    <mat-card class="integration-card discord-card">
      <div class="integration-icon">
        <mat-icon class="discord-icon">discord</mat-icon>
      </div>
      <mat-card-content>
        <h3 class="integration-name">Discord</h3>
        @if (isLoading()) {
          <div class="loading-state">
            <mat-spinner diameter="16"></mat-spinner>
            <span>Carregando...</span>
          </div>
        } @else {
          @if (discordStatus()?.isLinked) {
            <span class="integration-status linked">Conectado</span>
          } @else {
            <p class="integration-description">
              Notificações e acesso ao servidor do CACiC
            </p>
            <span class="integration-status not-linked">Não conectado</span>
          }
        }
      </mat-card-content>
      <mat-card-actions>
        <div class="action-buttons">
          @if (!isLoading()) {
            <button
              mat-icon-button
              matTooltip="Configurações de notificações"
              (click)="openNotificationSettings()"
              [disabled]="!discordStatus()?.isLinked"
            >
              <mat-icon>notifications</mat-icon>
            </button>

            <button
              mat-icon-button
              matTooltip="Servidor do CACiC"
              (click)="openDiscordServer()"
              [disabled]="!discordStatus()?.inviteLink"
            >
              <mat-icon>groups</mat-icon>
            </button>

            <button
              mat-icon-button
              matTooltip="Gerenciar vínculo"
              routerLink="/settings/linked-accounts"
              color="primary"
            >
              <mat-icon>settings</mat-icon>
            </button>
          }
        </div>
      </mat-card-actions>
    </mat-card>
  `,
  styles: [
    `
      .integration-card {
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 200px;
        transition:
          transform 0.2s,
          box-shadow 0.2s;
      }

      .integration-card:hover {
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
      }

      .integration-icon {
        display: flex;
        justify-content: center;
        padding: 16px 0 8px;
      }

      .discord-icon {
        font-size: 48px;
        width: 48px;
        height: 48px;
        color: #5865f2;
      }

      mat-card-content {
        flex: 1;
        text-align: center;
        padding: 8px 16px 16px;
      }

      .integration-name {
        margin: 8px 0;
        font-size: 1.2rem;
        font-weight: 500;
      }

      .integration-description {
        margin: 8px 0;
        color: #666;
        font-size: 0.9rem;
      }

      .integration-status {
        display: inline-block;
        padding: 4px 12px;
        border-radius: 12px;
        font-size: 0.8rem;
        font-weight: 500;

        &.linked {
          background: var(--md-sys-color-primary-container, #e3f2fd);
          color: var(--md-sys-color-on-primary-container, #1976d2);
        }

        &.not-linked {
          background: var(--md-sys-color-surface-variant, #f5f5f5);
          color: var(--md-sys-color-on-surface-variant, #666);
        }
      }

      .loading-state {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
        color: #666;
        font-size: 0.9rem;
      }

      mat-card-actions {
        padding: 8px 16px 16px;
      }

      .action-buttons {
        display: flex;
        justify-content: center;
        gap: 4px;
      }

      mat-icon-button {
        transition: background-color 0.2s;
      }

      mat-icon-button:disabled {
        opacity: 0.5;
      }
    `,
  ],
})
export class DiscordIntegrationCardComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private router = inject(Router);

  isLoading = signal(false);
  discordStatus = signal<DiscordLinkStatus | null>(null);
  private focusListener?: () => void;

  ngOnInit(): void {
    this.loadDiscordStatus();

    // Refresh data when window regains focus (user might have completed actions in another tab)
    this.focusListener = () => {
      if (!document.hidden && !this.isLoading()) {
        this.loadDiscordStatus();
      }
    };
    window.addEventListener('focus', this.focusListener);
    document.addEventListener('visibilitychange', this.focusListener);
  }

  ngOnDestroy(): void {
    if (this.focusListener) {
      window.removeEventListener('focus', this.focusListener);
      document.removeEventListener('visibilitychange', this.focusListener);
    }
  }

  private loadDiscordStatus(): void {
    this.isLoading.set(true);
    this.apiService.getDiscordLinkStatusFresh().subscribe({
      next: (status: DiscordLinkStatus) => {
        this.discordStatus.set(status);
        this.isLoading.set(false);
      },
      error: (error: unknown) => {
        console.error('Error loading Discord status:', error);
        this.isLoading.set(false);
      },
    });
  }
  openNotificationSettings(): void {
    // TODO: Implement notification settings navigation
    console.log('Open notification settings');
  }

  openDiscordServer(): void {
    const inviteLink = this.discordStatus()?.inviteLink;
    if (inviteLink) {
      window.open(inviteLink, '_blank', 'noopener,noreferrer');
    }
  }
}
