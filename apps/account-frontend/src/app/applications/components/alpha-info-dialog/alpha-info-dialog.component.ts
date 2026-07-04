import { Component } from '@angular/core';
import { MatDialogModule } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatCardModule } from '@angular/material/card';

@Component({
  selector: 'app-alpha-info-dialog',
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatCardModule],
  template: `
    <div class="dialog-header">
      <div class="header-content">
        <mat-icon class="alpha-icon">science</mat-icon>
        <h2 mat-dialog-title>Versão Alpha</h2>
      </div>
      <button mat-icon-button mat-dialog-close class="close-button" aria-label="Fechar">
        <mat-icon>close</mat-icon>
      </button>
    </div>

    <mat-dialog-content class="dialog-content">
      <div class="info-section">
        <h4><mat-icon>speed</mat-icon> Aja rápido e quebre as coisas</h4>
        <p>Priorizamos a entrega rápida de funcionalidades úteis, o que pode resultar em bugs ocasionais.</p>
      </div>

      <div class="info-section">
        <h4><mat-icon>palette</mat-icon> Função sobre forma</h4>
        <p>
          Você pode encontrar pequenos problemas visuais, elementos desalinhados ou interfaces que ainda não estão
          totalmente polidas.
        </p>
      </div>

      <div class="info-section">
        <h4><mat-icon>security</mat-icon> Segurança garantida</h4>
        <p>Mesmo em fase alpha, mantemos altos padrões de segurança para proteger seus dados e a sua privacidade.</p>
      </div>

      <div class="info-section">
        <h4><mat-icon>feedback</mat-icon> Encontrou algum problema?</h4>
        <p>Abra uma issue no GitHub.</p>
      </div>
    </mat-dialog-content>
  `,
  styles: [
    `
      .dialog-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 24px 24px 0 24px;
        margin-bottom: 16px;
      }

      .header-content {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .alpha-icon {
        font-size: 28px;
        width: 28px;
        height: 28px;
        color: var(--md-sys-color-primary);
      }

      h2 {
        margin: 0;
        color: var(--md-sys-color-on-surface);
        font-weight: 500;
      }

      .close-button {
        color: var(--md-sys-color-on-surface-variant);
      }

      .dialog-content {
        padding: 0 24px;
        max-width: 500px;
      }

      .info-section {
        margin-bottom: 20px;
        padding: 16px 0;
      }

      .info-section h4 {
        display: flex;
        align-items: center;
        gap: 8px;
        margin: 0 0 8px 0;
        font-size: 16px;
        font-weight: 500;
        color: var(--md-sys-color-primary);
      }

      .info-section h4 mat-icon {
        font-size: 20px;
        width: 20px;
        height: 20px;
      }

      .info-section p {
        margin: 0;
        line-height: 1.5;
        color: var(--md-sys-color-on-surface-variant);
      }

      .dialog-actions {
        padding: 16px 24px 24px 24px;
        justify-content: flex-end;
      }

      .dialog-actions button {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      /* Dark theme adjustments */
      @media (prefers-color-scheme: dark) {
        .warning-card {
          background: rgba(255, 193, 7, 0.1);
          border: 1px solid rgba(255, 193, 7, 0.2);
        }

        .feedback-section {
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
      }
    `,
  ],
})
export class AlphaInfoDialogComponent {}
