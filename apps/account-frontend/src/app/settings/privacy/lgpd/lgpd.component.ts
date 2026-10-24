import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';

import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ApiService, LgpdRequest, DeleteAccountRequest } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { LgpdConfirmDialogComponent } from './lgpd-confirm-dialog.component';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';
import { DateFnsPipe } from '../../../shared/utils/date-fns.pipe';
import { getApiErrorMessage } from '../../../shared/utils/api-error-message';

type LgpdRequestStatus = LgpdRequest['status'];

const STATUS_LABELS: Record<LgpdRequestStatus, string> = {
  pending: 'Pendente',
  processing: 'Processando',
  completed: 'Concluído',
  failed: 'Falhou',
};

const STATUS_COLORS: Record<LgpdRequestStatus, 'accent' | 'primary' | 'warn'> = {
  pending: 'accent',
  processing: 'primary',
  completed: 'primary',
  failed: 'warn',
};

const STATUS_ICONS: Record<LgpdRequestStatus, string> = {
  pending: 'schedule',
  processing: 'autorenew',
  completed: 'check_circle',
  failed: 'error',
};

@Component({
  selector: 'app-lgpd',
  imports: [MatButtonModule, MatIconModule, MatProgressSpinnerModule, MatToolbarModule, RouterLink, DateFnsPipe],
  templateUrl: './lgpd.component.html',
  styleUrl: './lgpd.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LgpdComponent implements OnInit {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  protected isLoading = signal(false);
  protected hasLoadError = signal(false);
  protected loadErrorMessage = signal('');
  protected isCreatingRequest = signal(false);
  protected isDeletingAccount = signal(false);
  protected requests = signal<LgpdRequest[]>([]);

  protected readonly orderedRequests = computed(() =>
    [...this.requests()].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
  );
  protected readonly activeRequest = computed(() =>
    this.requests().some((request) => request.status === 'pending' || request.status === 'processing'),
  );
  protected readonly nextRequestAt = computed(() => {
    const latest = this.orderedRequests()[0];
    return latest ? new Date(new Date(latest.createdAt).getTime() + 24 * 60 * 60 * 1000) : null;
  });

  protected readonly canCreateNewRequest = computed(() => {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;

    return !this.requests().some((request) => {
      const createdAt = new Date(request.createdAt).getTime();

      return createdAt > oneDayAgo || request.status === 'pending' || request.status === 'processing';
    });
  });

  ngOnInit(): void {
    this.loadRequests();
  }

  protected loadRequests(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);
    this.loadErrorMessage.set('');
    this.apiService.getLgpdRequests().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.hasLoadError.set(true);
        this.loadErrorMessage.set(
          getApiErrorMessage(
            error,
            'Não foi possível carregar suas solicitações de dados. Atualize a lista para tentar novamente.',
          ),
        );
        this.snackBar.open(this.loadErrorMessage(), 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        this.isLoading.set(false);
      },
    });
  }

  protected refreshRequests(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);
    this.loadErrorMessage.set('');
    this.apiService.getLgpdRequestsFresh().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: (error) => {
        this.hasLoadError.set(true);
        this.loadErrorMessage.set(
          getApiErrorMessage(
            error,
            'Não foi possível atualizar suas solicitações de dados. Tente novamente em alguns instantes.',
          ),
        );
        this.snackBar.open(this.loadErrorMessage(), 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        this.isLoading.set(false);
      },
    });
  }

  protected createRequest(): void {
    const dialogRef = this.dialog.open(LgpdConfirmDialogComponent, {
      width: '500px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.executeCreateRequest();
      }
    });
  }

  private executeCreateRequest(): void {
    this.isCreatingRequest.set(true);
    this.apiService.createLgpdRequest().subscribe({
      next: () => {
        this.snackBar.open('Solicitação criada com sucesso! O processamento pode levar alguns minutos.', 'Fechar', {
          duration: 8000,
          panelClass: ['success-snackbar'],
        });
        this.loadRequests(); // Reload to show the new request
        this.isCreatingRequest.set(false);
      },
      error: (error) => {
        const errorMessage = getApiErrorMessage(
          error,
          'Não foi possível solicitar a cópia dos seus dados. Atualize a lista para ver se o pedido foi registrado.',
        );

        this.snackBar.open(errorMessage, 'Fechar', {
          duration: 8000,
          panelClass: ['error-snackbar'],
        });
        this.isCreatingRequest.set(false);
      },
    });
  }

  protected downloadFile(request: LgpdRequest): void {
    if (request.status !== 'completed') {
      this.snackBar.open('O arquivo ainda não está pronto para download.', 'Fechar', {
        duration: 5000,
        panelClass: ['warning-snackbar'],
      });
      return;
    }

    // Check if expired
    if (request.expiresAt && new Date() > new Date(request.expiresAt)) {
      this.snackBar.open('O link para download expirou.', 'Fechar', {
        duration: 5000,
        panelClass: ['error-snackbar'],
      });
      return;
    }

    // Open download link in new window to trigger download
    const downloadUrl = this.apiService.downloadLgpdFile(request.id);
    const downloadWindow = window.open(downloadUrl, '_blank', 'noopener');

    if (downloadWindow) {
      downloadWindow.opener = null;
    }

    // Reload requests to update download timestamp (will use fresh data)
    setTimeout(() => this.refreshRequests(), 1000);
  }

  protected getStatusLabel(status: LgpdRequestStatus): string {
    return STATUS_LABELS[status];
  }

  protected getStatusColor(status: LgpdRequestStatus): 'accent' | 'primary' | 'warn' {
    return STATUS_COLORS[status];
  }

  protected getStatusIcon(status: LgpdRequestStatus): string {
    return STATUS_ICONS[status];
  }

  protected formatFileSize(bytes?: number): string {
    if (!bytes || bytes <= 0) return '-';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), sizes.length - 1);

    return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
  }

  protected canDownload(request: LgpdRequest): boolean {
    return request.status === 'completed' && (!request.expiresAt || new Date() <= new Date(request.expiresAt));
  }

  protected isExpired(request: LgpdRequest): boolean {
    return request.expiresAt !== undefined && new Date() > new Date(request.expiresAt);
  }

  protected openDeleteAccountDialog(): void {
    const dialogRef = this.dialog.open(DeleteAccountDialogComponent, {
      width: '600px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((result: DeleteAccountRequest | null) => {
      if (result) {
        this.deleteAccount(result);
      }
    });
  }

  private deleteAccount(request: DeleteAccountRequest): void {
    this.isDeletingAccount.set(true);

    this.apiService.deleteAccount(request).subscribe({
      next: () => {
        this.snackBar.open(
          'Solicitação de exclusão de conta enviada com sucesso. Você será redirecionado para a página de login.',
          'Fechar',
          { duration: 5000 },
        );

        // Redirect to login after successful deletion request
        setTimeout(() => {
          this.authService.logout();
          this.router.navigate(['/login']);
        }, 2000);
      },
      error: (error) => {
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível confirmar o pedido de exclusão. Entre em contato com o suporte para verificar se ele foi registrado.',
          ),
          'Fechar',
          { duration: 5000 },
        );
        this.isDeletingAccount.set(false);
      },
    });
  }
}
