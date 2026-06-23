import { Component, inject } from '@angular/core';

import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';

@Component({
  selector: 'app-delete-account-dialog',
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatIconModule,
    ReactiveFormsModule
],
  template: `
    <h2 mat-dialog-title class="warning-title">
      <mat-icon>warning</mat-icon>
      Excluir Conta Permanentemente
    </h2>
    
    <mat-dialog-content>
      <div class="warning-content">
        <p><strong>ATENÇÃO: sua conta será desativada imediatamente.</strong></p>
    
        <p>A exclusão da sua conta resultará em:</p>
        <ul>
          <li>Bloqueio de acesso ao CACiC SSO e aplicações vinculadas</li>
          <li>Ocultação dos seus dados nos sistemas CACiC</li>
          <li>Retenção dos dados por 1 ano para prevenção a fraude e invasões de conta</li>
          <li>Exclusão definitiva após 1 ano, salvo reativação administrativa</li>
        </ul>
    
        <p>Os seguintes serviços serão notificados sobre o agendamento:</p>
        <ul>
          <li>Keycloak (sistema de autenticação)</li>
          <li>Serviço de usuários</li>
          <li>Sistemas externos integrados</li>
        </ul>
    
        <form [formGroup]="deleteForm" class="delete-form">
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Digite "DELETE" para confirmar</mat-label>
            <input
              matInput
              formControlName="confirmation"
              placeholder="DELETE"
              autocomplete="off"
              />
            @if (deleteForm.get('confirmation')?.hasError('required')) {
              <mat-error
                >
                Confirmação é obrigatória
              </mat-error>
            }
            @if (deleteForm.get('confirmation')?.hasError('pattern')) {
              <mat-error
                >
                Digite exatamente "DELETE"
              </mat-error>
            }
          </mat-form-field>
    
          <mat-form-field appearance="outline" class="full-width">
            <mat-label>Motivo da exclusão (opcional)</mat-label>
            <textarea
              matInput
              formControlName="reason"
              placeholder="Ex: Não preciso mais do serviço"
              rows="3"
            ></textarea>
          </mat-form-field>
        </form>
      </div>
    </mat-dialog-content>
    
    <mat-dialog-actions align="end">
      <button mat-button (click)="cancel()">Cancelar</button>
      <button
        mat-raised-button
        color="warn"
        [disabled]="!deleteForm.valid"
        (click)="confirm()"
        >
        <mat-icon>delete_forever</mat-icon>
        Solicitar Exclusão
      </button>
    </mat-dialog-actions>
    `,
  styles: [
    `
      .warning-title {
        color: #f44336;
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .warning-content {
        max-width: 500px;
      }

      .warning-content p {
        margin-bottom: 16px;
      }

      .warning-content ul {
        margin: 8px 0 16px 0;
        padding-left: 20px;
      }

      .warning-content li {
        margin-bottom: 4px;
      }

      .delete-form {
        margin-top: 24px;
      }

      .full-width {
        width: 100%;
      }

      mat-dialog-actions {
        padding: 16px 0;
      }
    `,
  ],
})
export class DeleteAccountDialogComponent {
  private dialogRef = inject(MatDialogRef<DeleteAccountDialogComponent>);
  private fb = inject(FormBuilder);

  deleteForm = this.fb.group({
    confirmation: ['', [Validators.required, Validators.pattern(/^DELETE$/)]],
    reason: [''],
  });

  cancel(): void {
    this.dialogRef.close(null);
  }

  confirm(): void {
    if (this.deleteForm.valid) {
      this.dialogRef.close({
        confirmation: this.deleteForm.value.confirmation!,
        reason: this.deleteForm.value.reason || undefined,
      });
    }
  }
}
