import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';

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
import {
  ApiService,
  DiscordAuthUrl,
  DiscordLinkStatus,
} from '../../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../../shared/components/confirmation-dialog.component';
import { getDiscordAvatarUrl } from '@cacic/shared-utils';

type BannerType = 'success' | 'error' | 'warning' | 'info';

interface BannerConfig {
  type: BannerType;
  title: string;
  message: string;
  icon: string;
  visible: boolean;
  dismissible?: boolean;
}

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
    MatTooltipModule
],
  templateUrl: './discord-integration.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './discord-integration.component.scss',
})
export class DiscordIntegrationComponent implements OnInit, OnDestroy {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  isLoading = signal(false);
  isLinking = signal(false);
  isUnlinking = signal(false);
  hasLoadError = signal(false);
  discordStatus = signal<DiscordLinkStatus | null>(null);

  // Banner system
  currentBanner = signal<BannerConfig | null>(null);
  private bannerTimeout?: number;

  private showBanner(
    type: BannerType,
    title: string,
    message: string,
    dismissible = true,
    autoHide = false,
  ): void {
    // Clear any existing timeout
    if (this.bannerTimeout) {
      clearTimeout(this.bannerTimeout);
    }

    this.currentBanner.set({
      type,
      title,
      message,
      icon: this.getBannerIcon(type),
      visible: true,
      dismissible,
    });

    // Auto-hide banner after 5 seconds for success/info messages
    if (autoHide) {
      this.bannerTimeout = window.setTimeout(() => {
        this.dismissBanner();
      }, 5000);
    }
  }

  private getBannerIcon(type: BannerType): string {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'info';
    }
  }

  dismissBanner(): void {
    if (this.bannerTimeout) {
      clearTimeout(this.bannerTimeout);
      this.bannerTimeout = undefined;
    }

    this.currentBanner.set(null);

    // After dismissing any banner, check if we should show status-based banner
    // This ensures "no accounts" banner appears when errors are dismissed
    setTimeout(() => {
      this.updateBannerBasedOnStatus();
    }, 100);
  }

  private showSuccessBanner(title: string, message: string): void {
    this.showBanner('success', title, message, true, true); // Auto-hide success banners
  }

  private showErrorBanner(title: string, message: string): void {
    this.showBanner('error', title, message);
  }

  private showWarningBanner(title: string, message: string): void {
    this.showBanner('warning', title, message);
  }

  private showInfoBanner(title: string, message: string): void {
    this.showBanner('info', title, message);
  }

  private showNoAccountsBanner(): void {
    this.currentBanner.set({
      type: 'info',
      title: 'Nenhuma conta vinculada',
      message: 'Conecte sua conta do Discord para acessar o servidor do CACiC.',
      icon: 'link_off',
      visible: true,
      dismissible: false,
    });
  }

  private updateBannerBasedOnStatus(): void {
    // Only show status banner if there's no current error/success/warning banner
    const currentType = this.currentBanner()?.type;
    const hasImportantBanner =
      currentType && ['error', 'success', 'warning'].includes(currentType);

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
    if (this.bannerTimeout) {
      clearTimeout(this.bannerTimeout);
    }
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
        errorMessage =
          'Você precisa estar autenticado para vincular sua conta do Discord.';
        break;
      case 'missing_parameters':
        errorMessage =
          'Parâmetros OAuth inválidos. Tente vincular sua conta novamente.';
        break;
      case 'user_mismatch':
        errorMessage =
          'Erro de segurança: incompatibilidade de usuário. Faça login novamente.';
        break;
      case 'callback_failed':
        errorMessage =
          'Esta conta do Discord já está vinculada a um usuário ou ocorreu um erro no processo de vinculação.';
        break;
      case 'already_linked':
        errorMessage =
          'Esta conta do Discord já está vinculada a um usuário. Use uma conta diferente.';
        break;
      default:
        errorMessage = `Erro desconhecido (${errorType}). Tente novamente.`;
    }

    this.showErrorBanner('Erro na vinculação', errorMessage);
  }

  private handleOAuthSuccess(): void {
    this.showSuccessBanner(
      'Sucesso!',
      'Conta do Discord vinculada com sucesso!',
    );
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
        console.error('Error loading Discord status:', error);
        let errorMessage =
          'Falha ao carregar status do Discord. Tente recarregar a página.';

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
        console.error('Error getting Discord auth URL:', error);
        let errorMessage =
          'Falha ao iniciar vinculação do Discord. Tente novamente.';

        // Check for specific error messages from the backend
        if (error.status === 401) {
          errorMessage =
            'Você precisa estar autenticado para vincular sua conta do Discord.';
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
        this.showSuccessBanner(
          'Sucesso!',
          response.message || 'Conta desvinculada com sucesso!',
        );
        this.loadDiscordStatus(); // Reload status
        this.isUnlinking.set(false);
      },
      error: (error: HttpErrorResponse) => {
        console.error('Error unlinking Discord:', error);
        let errorMessage =
          'Falha ao desvincular conta do Discord. Tente novamente.';

        // Check for specific error messages from the backend
        if (error.status === 401) {
          errorMessage =
            'Você precisa estar autenticado para desvincular sua conta.';
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
    return (
      this.discordStatus()?.discordLinks?.some(
        (link) => link.assignedRole === 'visitor',
      ) || false
    );
  }

  formatDate(date: string | Date): string {
    return new Date(date).toLocaleDateString('pt-BR', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }
}
