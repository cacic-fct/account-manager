import { Component, inject } from '@angular/core';
import { MatDialogRef, MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-reject-document-dialog',
  template: `
    <div class="dialog-container">
      <div class="dialog-header">
        <mat-icon color="warn">close</mat-icon>
        <h2>Rejeitar Documento</h2>
      </div>

      <div class="dialog-content">
        <p>
          Por favor, forneça um motivo para a rejeição do documento. Este motivo
          será exibido para o estudante.
        </p>

        <mat-form-field appearance="outline" class="full-width">
          <mat-label>Motivo da rejeição</mat-label>
          <textarea
            matInput
            [(ngModel)]="reason"
            placeholder="Ex: Documento ilegível, informações incompletas, fora da validade..."
            rows="4"
            required
          ></textarea>
          <mat-hint
            >Seja específico para ajudar o estudante a corrigir o
            problema</mat-hint
          >
        </mat-form-field>
      </div>

      <div class="dialog-actions">
        <button mat-button (click)="cancel()">Cancelar</button>
        <button
          mat-raised-button
          color="warn"
          (click)="reject()"
          [disabled]="!reason || reason.trim().length === 0"
        >
          <mat-icon>close</mat-icon>
          Rejeitar Documento
        </button>
      </div>
    </div>
  `,
  styles: [
    `
      .dialog-container {
        padding: 1rem;
        min-width: 400px;
        max-width: 500px;
      }

      .dialog-header {
        display: flex;
        align-items: center;
        gap: 0.5rem;
        margin-bottom: 1rem;
      }

      .dialog-header h2 {
        margin: 0;
        font-size: 1.5rem;
        font-weight: 500;
      }

      .dialog-content {
        margin-bottom: 1.5rem;
      }

      .dialog-content p {
        color: #666;
        line-height: 1.5;
        margin-bottom: 1rem;
      }

      .full-width {
        width: 100%;
      }

      .dialog-actions {
        display: flex;
        justify-content: flex-end;
        gap: 0.5rem;
      }

      @media (prefers-color-scheme: dark) {
        .dialog-content p {
          color: #b0b0b0;
        }
      }
    `,
  ],
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    FormsModule,
  ],
})
export class RejectDocumentDialogComponent {
  private dialogRef = inject(MatDialogRef<RejectDocumentDialogComponent>);

  reason = '';

  cancel(): void {
    this.dialogRef.close(null);
  }

  reject(): void {
    if (this.reason && this.reason.trim().length > 0) {
      this.dialogRef.close(this.reason.trim());
    }
  }
}
