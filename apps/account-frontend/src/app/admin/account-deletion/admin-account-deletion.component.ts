import { Component, OnInit, inject, signal } from '@angular/core';
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
import { ApiService, AdminDeleteAccountRequest } from '../../shared/services/api.service';
import { ConfirmationDialogComponent } from '../../shared/components/confirmation-dialog.component';
import { DateFnsPipe } from '../../shared/utils/date-fns.pipe';
import { getApiErrorMessage } from '../../shared/utils/api-error-message';

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
    DateFnsPipe,
  ],
  templateUrl: './admin-account-deletion.component.html',
  styleUrl: './admin-account-deletion.component.scss',
})
export class AdminAccountDeletionComponent implements OnInit {
  private apiService = inject(ApiService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);

  protected requests = signal<AdminDeleteAccountRequest[]>([]);
  protected loading = signal(true);
  protected loadError = signal<string | null>(null);
  protected actionRequestId = signal<string | null>(null);
  protected displayedColumns = ['email', 'createdAt', 'softDeletedAt', 'scheduledHardDeleteAt', 'status', 'actions'];

  ngOnInit(): void {
    this.loadRequests();
  }

  protected loadRequests(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.apiService.getPendingAccountDeletionRequests().subscribe({
      next: (requests) => {
        this.requests.set(requests);
        this.loading.set(false);
      },
      error: (error: unknown) => {
        this.loadError.set(
          getApiErrorMessage(
            error,
            'Não foi possível carregar as solicitações de exclusão. Atualize a lista para tentar novamente.',
          ),
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
      error: (error: unknown) => {
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível verificar se a conta foi reativada. A lista será atualizada; confira o status antes de tentar novamente.',
          ),
          'Fechar',
          { duration: 8000 },
        );
        this.actionRequestId.set(null);
        this.loadRequests();
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
      error: (error: unknown) => {
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível verificar se a exclusão imediata foi processada. A lista será atualizada; confira o status antes de tentar novamente.',
          ),
          'Fechar',
          { duration: 8000 },
        );
        this.actionRequestId.set(null);
        this.loadRequests();
      },
    });
  }
}
