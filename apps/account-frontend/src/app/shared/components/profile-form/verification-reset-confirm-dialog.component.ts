import { Component, inject } from '@angular/core';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-verification-reset-confirm-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <mat-icon class="warning-icon">warning</mat-icon>
        <h2 mat-dialog-title>Redefinir status de verificação</h2>
      </div>

      <mat-dialog-content class="dialog-content">
        <p>
          As alterações que você está fazendo no seu
          <strong>Registro Acadêmico (RA)</strong> ou <strong>Vínculo com a Unesp</strong> irão invalidar seu status de
          verificação atual.
        </p>
        <p>
          Isso significa que você precisará refazer o processo de verificação de documentos para manter acesso a
          recursos que requerem verificação.
        </p>
        <p class="emphasis">Tem certeza de que deseja continuar?</p>
      </mat-dialog-content>

      <mat-dialog-actions class="dialog-actions">
        <button mat-button (click)="onCancel()">Cancelar</button>
        <button mat-flat-button color="warn" (click)="onConfirm()">Confirmar alterações</button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .dialog-container {
        max-width: 500px;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .warning-icon {
        color: #ff9800;
        font-size: 32px;
        width: 32px;
        height: 32px;
      }

      h2 {
        margin: 0;
        color: #333;
      }

      .dialog-content p {
        margin-bottom: 12px;
        line-height: 1.5;
      }

      .emphasis {
        font-weight: 500;
        color: #d32f2f;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 12px;
        margin-top: 24px;
      }
    `,
  ],
})
export class VerificationResetConfirmDialogComponent {
  private dialogRef = inject(MatDialogRef<VerificationResetConfirmDialogComponent>);

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
