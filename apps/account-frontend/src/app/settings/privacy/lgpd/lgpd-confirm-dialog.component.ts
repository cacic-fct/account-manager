import { Component, inject } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-lgpd-confirm-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <mat-icon class="dialog-icon">info</mat-icon>
        <h2 mat-dialog-title>Confirmar Solicitação de Dados</h2>
      </div>

      <mat-dialog-content>
        <p class="main-text">
          Você está prestes a solicitar uma cópia de todos os seus dados pessoais conforme a Lei Geral de Proteção de
          Dados (LGPD).
        </p>

        <div class="info-list">
          <div class="info-item">
            <mat-icon>schedule</mat-icon>
            <span>O processamento pode levar alguns minutos</span>
          </div>
          <div class="info-item">
            <mat-icon>folder_zip</mat-icon>
            <span>Dados serão organizados em arquivo ZIP com JSONs temáticos</span>
          </div>
          <div class="info-item">
            <mat-icon>timer</mat-icon>
            <span>Cooldown de 24 horas entre novas solicitações</span>
          </div>
          <div class="info-item">
            <mat-icon>event</mat-icon>
            <span>Arquivo expira em 7 dias após a geração</span>
          </div>
        </div>

        <p class="confirmation-text">Deseja prosseguir com a solicitação?</p>
      </mat-dialog-content>

      <mat-dialog-actions>
        <button mat-button (click)="onCancel()">Cancelar</button>
        <button mat-raised-button color="primary" (click)="onConfirm()">
          <mat-icon>download</mat-icon>
          Confirmar Solicitação
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .dialog-container {
        padding: 8px;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        gap: 12px;
        margin-bottom: 16px;
      }

      .dialog-icon {
        font-size: 32px;
        width: 32px;
        height: 32px;
        color: #1976d2;
      }

      h2 {
        margin: 0;
        color: #333;
      }

      .main-text {
        font-size: 16px;
        margin-bottom: 20px;
        line-height: 1.5;
      }

      .info-list {
        margin: 16px 0;
      }

      .info-item {
        display: flex;
        align-items: center;
        gap: 12px;
        margin: 12px 0;
        padding: 8px;
        background: #f5f5f5;
        border-radius: 4px;
      }

      .info-item mat-icon {
        color: #666;
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .confirmation-text {
        font-weight: 500;
        margin-top: 20px;
        margin-bottom: 8px;
      }

      mat-dialog-actions {
        justify-content: flex-end;
        gap: 8px;
        padding-top: 16px;
      }

      button {
        min-width: 120px;
      }
    `,
  ],
})
export class LgpdConfirmDialogComponent {
  private dialogRef = inject(MatDialogRef<LgpdConfirmDialogComponent>);

  onCancel(): void {
    this.dialogRef.close(false);
  }

  onConfirm(): void {
    this.dialogRef.close(true);
  }
}
