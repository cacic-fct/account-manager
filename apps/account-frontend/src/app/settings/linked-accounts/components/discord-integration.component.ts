import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';

import { HttpErrorResponse } from '@angular/common/http';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatDialog } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ActivatedRoute, Router, RouterModule } from '@angular/router';
import { ApiService, DiscordAuthUrl, DiscordLinkStatus } from '../../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../../shared/components/confirmation-dialog.component';
import { getDiscordAvatarUrl } from '@cacic/shared-utils';
import { TransientBannerController } from '../../../shared/ui/transient-banner.controller';
import { LoggerService } from '../../../shared/services/logger.service';
import { formatLocalizedDate } from '../../../shared/utils/date-fns';

@Component({
  selector: 'app-discord-integration',
  imports: [
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatChipsModule,
    MatDividerModule,
    MatTooltipModule,
  ],
  templateUrl: './discord-integration.component.html',
  styleUrl: './discord-integration.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DiscordIntegrationComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private logger = inject(LoggerService);

  isLoading = signal(false);
  isLinking = signal(false);
  isUnlinking = signal(false);
  hasLoadError = signal(false);
  discordStatus = signal<DiscordLinkStatus | null>(null);

  private banners = new TransientBannerController();
  currentBanner = this.banners.currentBanner;

  dismissBanner(): void {
    this.banners.dismiss();

    // After dismissing any banner, check if we should show status-based banner
    // This ensures "no accounts" banner appears when errors are dismissed
    setTimeout(() => {
      this.updateBannerBasedOnStatus();
    }, 100);
  }

  private showSuccessBanner(title: string, message: string): void {
    this.banners.showSuccess(title, message);
  }

  private showErrorBanner(title: string, message: string): void {
    this.banners.showError(title, message);
  }

  private showWarningBanner(title: string, message: string): void {
    this.banners.showWarning(title, message);
  }

  private showInfoBanner(title: string, message: string): void {
    this.banners.showInfo(title, message);
  }

  private showNoAccountsBanner(): void {
    this.banners.show(
      'info',
      'Nenhuma conta vinculada',
      'Conecte sua conta do Discord para acessar o servidor do CACiC.',
      { dismissible: false, icon: 'link_off' },
    );
  }

  private updateBannerBasedOnStatus(): void {
    // Only show status banner if there's no current error/success/warning banner
    const currentType = this.currentBanner()?.type;
    const hasImportantBanner = currentType && ['error', 'success', 'warning'].includes(currentType);

    if (!hasImportantBanner) {
      const status = this.discordStatus();
      if (status && !status.isLinked) {
        // this.showNoAccountsBanner();
      } else if (currentType === 'info') {
        // Clear info banner when accounts are linked
        this.currentBanner.set(null);
      }
    }
  }

  ngOnInit(): void {
    this.checkForOAuthCallback();
    this.loadDiscordStatus();

    // Initialize banner based on initial status
    setTimeout(() => {
      this.updateBannerBasedOnStatus();
    }, 100);
  }

  ngOnDestroy(): void {
    this.banners.destroy();
  }

  private checkForOAuthCallback(): void {
    const queryParams = this.route.snapshot.queryParams;

    if (queryParams['error']) {
      this.handleOAuthError(queryParams['error']);
      // Clear query parameters from URL
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    } else if (queryParams['success'] === 'true') {
      this.handleOAuthSuccess();
      // Clear query parameters from URL
      this.router.navigate([], {
        relativeTo: this.route,
        queryParams: {},
        replaceUrl: true,
      });
    }
  }

  private handleOAuthError(errorType: string): void {
    let errorMessage = 'Falha ao vincular conta do Discord. Tente novamente.';

    switch (errorType) {
      case 'not_authenticated':
        errorMessage = 'Você precisa estar autenticado para vincular sua conta do Discord.';
        break;
      case 'missing_parameters':
        errorMessage = 'Parâmetros OAuth inválidos. Tente vincular sua conta novamente.';
        break;
      case 'user_mismatch':
        errorMessage = 'Erro de segurança: incompatibilidade de usuário. Faça login novamente.';
        break;
      case 'callback_failed':
        errorMessage =
          'Esta conta do Discord já está vinculada a um usuário ou ocorreu um erro no processo de vinculação.';
        break;
      case 'already_linked':
        errorMessage = 'Esta conta do Discord já está vinculada a um usuário. Use uma conta diferente.';
        break;
      default:
        errorMessage = `Erro desconhecido (${errorType}). Tente novamente.`;
    }

    this.showErrorBanner('Erro na vinculação', errorMessage);
  }

  private handleOAuthSuccess(): void {
    this.showSuccessBanner('Sucesso!', 'Conta do Discord vinculada com sucesso!');
    // Reload status to update the UI with the new linked account
    this.loadDiscordStatus();
  }

  loadDiscordStatus(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);

    // Only dismiss banners if they are info type (status banners)
    const currentBannerType = this.currentBanner()?.type;
    if (currentBannerType === 'info') {
      this.dismissBanner();
    }

    this.apiService.getDiscordLinkStatusFresh().subscribe({
      next: (status: DiscordLinkStatus) => {
        this.discordStatus.set(status);
        this.isLoading.set(false);
        this.hasLoadError.set(false);
        this.updateBannerBasedOnStatus(); // Update banner based on the loaded status
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error loading Discord status', error, { operation: 'discord-status' });
        let errorMessage = 'Falha ao carregar status do Discord. Tente recarregar a página.';

        if (error.status === 401) {
          errorMessage = 'Sessão expirada. Faça login novamente.';
        } else if (error.error?.message) {
          errorMessage = error.error.message;
        }

        this.showErrorBanner('Erro ao carregar', errorMessage);
        this.isLoading.set(false);
        this.hasLoadError.set(true);
      },
    });
  }

  linkDiscord(): void {
    this.isLinking.set(true);
    this.apiService.getDiscordAuthUrl().subscribe({
      next: (response: DiscordAuthUrl) => {
        // Redirect to Discord OAuth
        window.location.href = response.authUrl;
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error getting Discord auth URL', error, { operation: 'discord-link' });
        let errorMessage = 'Falha ao iniciar vinculação do Discord. Tente novamente.';

        // Check for specific error messages from the backend
        if (error.status === 401) {
          errorMessage = 'Você precisa estar autenticado para vincular sua conta do Discord.';
        } else if (error.status === 400 && error.error?.message) {
          errorMessage = error.error.message;
        } else if (error.error?.message) {
          errorMessage = error.error.message;
        }

        this.showErrorBanner('Erro na vinculação', errorMessage);
        this.isLinking.set(false);
      },
    });
  }

  unlinkDiscordAccount(linkId: string, displayName: string): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      data: {
        title: 'Desvincular conta do Discord',
        message: `Tem certeza que deseja desvincular a conta "${displayName}"? Você perderá acesso ao servidor do CACiC com esta conta.`,
        confirmText: 'Desvincular',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        this.performUnlink(linkId);
      }
    });
  }

  private performUnlink(linkId: string): void {
    this.isUnlinking.set(true);
    this.apiService.unlinkDiscord(linkId).subscribe({
      next: (response: { message: string }) => {
        this.showSuccessBanner('Sucesso!', response.message || 'Conta desvinculada com sucesso!');
        this.loadDiscordStatus(); // Reload status
        this.isUnlinking.set(false);
      },
      error: (error: HttpErrorResponse) => {
        this.logger.error('Error unlinking Discord', error, { operation: 'discord-unlink' });
        let errorMessage = 'Falha ao desvincular conta do Discord. Tente novamente.';

        // Check for specific error messages from the backend
        if (error.status === 401) {
          errorMessage = 'Você precisa estar autenticado para desvincular sua conta.';
        } else if (error.status === 404) {
          errorMessage = 'Conta não encontrada ou já desvinculada.';
        } else if (error.error?.message) {
          errorMessage = error.error.message;
        }

        this.showErrorBanner('Erro ao desvincular', errorMessage);
        this.isUnlinking.set(false);
      },
    });
  }

  getRoleChipClass(role: string): string {
    if (role === 'student') {
      return 'role-student';
    }

    if (role === 'unesp') {
      return 'role-unesp';
    }

    return 'role-visitor';
  }

  getDiscordAvatarUrl(discordId: string, avatarHash?: string): string {
    return getDiscordAvatarUrl(discordId, avatarHash, 128);
  }

  onAvatarError(event: Event): void {
    const target = event.target as HTMLImageElement;
    const fallbackIcon = target.nextElementSibling as HTMLElement;
    if (target && fallbackIcon) {
      target.style.display = 'none';
      fallbackIcon.style.display = 'flex';
    }
  }

  hasVisitorRole(): boolean {
    return this.discordStatus()?.discordLinks?.some((link) => link.assignedRole === 'visitor') || false;
  }

  formatDate(date: string | Date): string {
    return formatLocalizedDate(date, 'PP');
  }
}
