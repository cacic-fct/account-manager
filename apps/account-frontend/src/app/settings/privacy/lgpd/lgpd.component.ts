import { Component, inject, signal, OnInit } from '@angular/core';

import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTableModule } from '@angular/material/table';
import { MatChipsModule } from '@angular/material/chips';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { Router, RouterLink } from '@angular/router';
import {
  ApiService,
  LgpdRequest,
  DeleteAccountRequest,
} from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { LgpdConfirmDialogComponent } from './lgpd-confirm-dialog.component';
import { DeleteAccountDialogComponent } from './delete-account-dialog.component';
import { MatToolbar } from '@angular/material/toolbar';

@Component({
  selector: 'app-lgpd',
  imports: [
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatChipsModule,
    MatToolbar,
    RouterLink
],
  templateUrl: './lgpd.component.html',
  styleUrl: './lgpd.component.scss',
})
export class LgpdComponent implements OnInit {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private router = inject(Router);

  isLoading = signal(false);
  isCreatingRequest = signal(false);
  isDeletingAccount = signal(false);
  requests = signal<LgpdRequest[]>([]);

  displayedColumns: string[] = [
    'status',
    'createdAt',
    'fileName',
    'fileSize',
    'actions',
  ];

  ngOnInit(): void {
    this.loadRequests();
  }

  loadRequests(): void {
    this.isLoading.set(true);
    this.apiService.getLgpdRequests().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Erro ao carregar solicitações:', error);
        this.snackBar.open('Erro ao carregar solicitações', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        this.isLoading.set(false);
      },
    });
  }

  refreshRequests(): void {
    this.isLoading.set(true);
    this.apiService.getLgpdRequestsFresh().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.isLoading.set(false);
      },
      error: (error) => {
        console.error('Erro ao carregar solicitações:', error);
        this.snackBar.open('Erro ao carregar solicitações', 'Fechar', {
          duration: 5000,
          panelClass: ['error-snackbar'],
        });
        this.isLoading.set(false);
      },
    });
  }

  createRequest(): void {
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
      next: (request) => {
        this.snackBar.open(
          'Solicitação criada com sucesso! O processamento pode levar alguns minutos.',
          'Fechar',
          {
            duration: 8000,
            panelClass: ['success-snackbar'],
          },
        );
        this.loadRequests(); // Reload to show the new request
        this.isCreatingRequest.set(false);
      },
      error: (error) => {
        console.error('Erro ao criar solicitação:', error);
        const errorMessage =
          error.error?.message ||
          'Erro ao criar solicitação. Tente novamente mais tarde.';
        this.snackBar.open(errorMessage, 'Fechar', {
          duration: 8000,
          panelClass: ['error-snackbar'],
        });
        this.isCreatingRequest.set(false);
      },
    });
  }

  downloadFile(request: LgpdRequest): void {
    if (request.status !== 'completed') {
      this.snackBar.open(
        'O arquivo ainda não está pronto para download.',
        'Fechar',
        {
          duration: 5000,
          panelClass: ['warning-snackbar'],
        },
      );
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
    window.open(downloadUrl, '_blank');

    // Reload requests to update download timestamp (will use fresh data)
    setTimeout(() => this.refreshRequests(), 1000);
  }

  getStatusLabel(status: string): string {
    const statusLabels: Record<string, string> = {
      pending: 'Pendente',
      processing: 'Processando',
      completed: 'Concluído',
      failed: 'Falhou',
    };
    return statusLabels[status] || status;
  }

  getStatusColor(status: string): string {
    const statusColors: Record<string, string> = {
      pending: 'accent',
      processing: 'primary',
      completed: 'primary',
      failed: 'warn',
    };
    return statusColors[status] || 'basic';
  }

  formatFileSize(bytes?: number): string {
    if (!bytes) return '-';
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return `${Math.round((bytes / Math.pow(1024, i)) * 100) / 100} ${sizes[i]}`;
  }

  formatDate(date: Date | string): string {
    const d = new Date(date);
    return d.toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  canDownload(request: LgpdRequest): boolean {
    return (
      request.status === 'completed' &&
      (!request.expiresAt || new Date() <= new Date(request.expiresAt))
    );
  }

  isExpired(request: LgpdRequest): boolean {
    return (
      request.expiresAt !== undefined &&
      new Date() > new Date(request.expiresAt)
    );
  }

  openDeleteAccountDialog(): void {
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
      next: (response) => {
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
        console.error('Error deleting account:', error);
        this.snackBar.open(
          error.error?.message ||
            'Erro ao solicitar exclusão da conta. Tente novamente.',
          'Fechar',
          { duration: 5000 },
        );
        this.isDeletingAccount.set(false);
      },
    });
  }

  canCreateNewRequest(): boolean {
    const recentRequests = this.requests().filter((req) => {
      const oneDayAgo = new Date();
      oneDayAgo.setDate(oneDayAgo.getDate() - 1);
      return (
        new Date(req.createdAt) > oneDayAgo ||
        req.status === 'pending' ||
        req.status === 'processing'
      );
    });
    return recentRequests.length === 0;
  }
}
