import { Component, OnInit, inject, signal, ChangeDetectionStrategy } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ApiService,
  AdminDeleteAccountRequest,
} from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';

@Component({
  selector: 'app-admin-account-deletion',
  imports: [
    RouterLink,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTableModule,
    MatToolbarModule,
    MatTooltipModule,
  ],
  templateUrl: './admin-account-deletion.component.html',
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: './admin-account-deletion.component.scss',
})
export class AdminAccountDeletionComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  protected requests = signal<AdminDeleteAccountRequest[]>([]);
  protected loading = signal(true);
  protected actionRequestId = signal<string | null>(null);
  protected displayedColumns = [
    'email',
    'createdAt',
    'softDeletedAt',
    'scheduledHardDeleteAt',
    'status',
    'actions',
  ];

  ngOnInit(): void {
    this.loadRequests();
  }

  protected loadRequests(): void {
    this.loading.set(true);
    this.apiService.getPendingAccountDeletionRequests().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.loading.set(false);
      },
      error: () => {
        this.snackBar.open(
          'Erro ao carregar solicitações de exclusão.',
          'Fechar',
          { duration: 5000 },
        );
        this.loading.set(false);
      },
    });
  }

  protected confirmUndo(request: AdminDeleteAccountRequest): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Reativar conta',
        message: `Você tem certeza que deseja reativar a conta ${request.email}? A conta será habilitada no CACiC SSO e os sistemas externos serão avisados para cancelar a exclusão agendada.`,
        confirmText: 'Reativar',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.undo(request.id);
      }
    });
  }

  protected confirmDeleteNow(request: AdminDeleteAccountRequest): void {
    const dialogRef = this.dialog.open(ConfirmationDialogComponent, {
      width: '460px',
      data: {
        title: 'Excluir agora',
        message: `Você tem certeza que deseja executar a exclusão definitiva da conta ${request.email} agora? Esta ação antecipa a exclusão agendada e remove os dados retidos.`,
        confirmText: 'Excluir agora',
        cancelText: 'Cancelar',
      },
    });

    dialogRef.afterClosed().subscribe((confirmed) => {
      if (confirmed) {
        this.deleteNow(request.id);
      }
    });
  }

  protected formatDate(date?: Date | string): string {
    if (!date) return '-';
    return new Date(date).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  protected getStatusLabel(status: string): string {
    const labels: Record<string, string> = {
      pending: 'Pendente',
      processing: 'Processando',
      completed: 'Concluído',
      failed: 'Falhou',
    };

    return labels[status] || status;
  }

  private undo(requestId: string): void {
    this.actionRequestId.set(requestId);
    this.apiService.undoAccountDeletionRequest(requestId).subscribe({
      next: () => {
        this.snackBar.open('Conta reativada com sucesso.', 'Fechar', {
          duration: 4000,
        });
        this.actionRequestId.set(null);
        this.loadRequests();
      },
      error: () => {
        this.snackBar.open('Erro ao reativar conta.', 'Fechar', {
          duration: 5000,
        });
        this.actionRequestId.set(null);
      },
    });
  }

  private deleteNow(requestId: string): void {
    this.actionRequestId.set(requestId);
    this.apiService.deleteAccountNow(requestId).subscribe({
      next: () => {
        this.snackBar.open('Exclusão definitiva agendada para agora.', 'Fechar', {
          duration: 4000,
        });
        this.actionRequestId.set(null);
        this.loadRequests();
      },
      error: () => {
        this.snackBar.open('Erro ao agendar exclusão imediata.', 'Fechar', {
          duration: 5000,
        });
        this.actionRequestId.set(null);
      },
    });
  }
}
