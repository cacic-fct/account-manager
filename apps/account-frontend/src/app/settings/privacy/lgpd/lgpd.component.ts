import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import { MatToolbarModule } from '@angular/material/toolbar';
import { ApiService, LgpdRequest, DeleteAccountRequest } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { LgpdConfirmDialogComponent } from './lgpd-confirm-dialog.component';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';

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
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatTooltipModule,
    MatToolbarModule,
    RouterLink,
  ],
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
  protected isCreatingRequest = signal(false);
  protected isDeletingAccount = signal(false);
  protected requests = signal<LgpdRequest[]>([]);

  protected readonly displayedColumns = ['status', 'createdAt', 'fileSize', 'actions'];

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
    this.apiService.getLgpdRequests().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar solicitações', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        this.isLoading.set(false);
      },
    });
  }

  protected refreshRequests(): void {
    this.isLoading.set(true);
    this.apiService.getLgpdRequestsFresh().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: () => {
        this.snackBar.open('Erro ao carregar solicitações', 'Fechar', {
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
        const errorMessage = this.getApiErrorMessage(error, 'Erro ao criar solicitação. Tente novamente mais tarde.');

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

  protected formatDate(date?: Date | string): string {
    if (!date) return '-';
    const d = new Date(date);

    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
          this.getApiErrorMessage(error, 'Erro ao solicitar exclusão da conta. Tente novamente.'),
          'Fechar',
          { duration: 5000 },
        );
        this.isDeletingAccount.set(false);
      },
    });
  }

  private getApiErrorMessage(error: unknown, fallback: string): string {
    if (typeof error !== 'object' || error === null || !('error' in error)) {
      return fallback;
    }

    const body = (error as { error?: { message?: unknown } }).error;

    return typeof body?.message === 'string' ? body.message : fallback;
  }
}
