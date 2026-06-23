import { Component, inject, signal, Inject, ChangeDetectionStrategy } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import {
  MatDialogModule,
  MAT_DIALOG_DATA,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import {
  UniversityValidationService,
  CaptchaResponse,
  ValidationResponse,
  AtomicValidationResponse,
} from '../../../../shared/services/university-validation/university-validation.service';

export interface UniversityValidationDialogData {
  pdfFile: File;
}

@Component({
  selector: 'app-university-validation-dialog',
  template: `
    <div class="university-validation-dialog">
      <h2 mat-dialog-title>Validar documento</h2>

      <mat-dialog-content>
        <div class="validation-form">
          <p class="description">
            @if (captchaImage()) {
              Digite o código de segurança para finalizar a validação.
            } @else {
              Processando arquivo...
            }
          </p>

          @if (loading()) {
            <div class="loading-container">
              <mat-spinner diameter="40"></mat-spinner>
              <p>Carregando Captcha...</p>
            </div>
          } @else {
            @if (captchaImage()) {
              <div class="captcha-container">
                <img
                  [src]="captchaImage()"
                  alt="Código de segurança"
                  class="captcha-image"
                />
                <button
                  mat-icon-button
                  (click)="refreshCaptcha()"
                  [disabled]="validating() || cooldownActive()"
                  [matTooltip]="
                    cooldownActive()
                      ? 'Aguarde ' + cooldownRemaining() + ' segundos'
                      : 'Atualizar captcha'
                  "
                >
                  @if (cooldownActive()) {
                    <span class="cooldown-text"
                      >{{ cooldownRemaining() }}s</span
                    >
                  } @else {
                    <mat-icon>refresh</mat-icon>
                  }
                </button>
              </div>
            }

            <mat-form-field appearance="outline" class="full-width">
              <mat-label>Código de segurança</mat-label>
              <input
                matInput
                [(ngModel)]="captchaCode"
                [disabled]="validating()"
                [placeholder]="
                  captchaImage()
                    ? 'Digite o código da imagem'
                    : 'Será solicitado após validação'
                "
                maxlength="10"
                (keyup.enter)="validateDocument()"
              />
            </mat-form-field>

            @if (errorMessage()) {
              <div class="error-message">
                <mat-icon color="warn">error</mat-icon>
                {{ errorMessage() }}
              </div>
            }
          }
        </div>
      </mat-dialog-content>

      <mat-dialog-actions align="end">
        <button mat-button (click)="onCancel()" [disabled]="validating()">
          Cancelar
        </button>

        <button
          mat-raised-button
          color="primary"
          (click)="validateDocument()"
          [disabled]="
            !captchaCode || validating() || loading() || cooldownActive()
          "
        >
          @if (validating()) {
            <mat-spinner diameter="20"></mat-spinner>
            Validando...
          } @else if (cooldownActive()) {
            Aguarde {{ cooldownRemaining() }}s
          } @else {
            Validar Documento
          }
        </button>
      </mat-dialog-actions>
    </div>
  `,
  styles: [
    `
      .university-validation-dialog {
        min-width: 400px;
        max-width: 500px;
      }

      .validation-form {
        display: flex;
        flex-direction: column;
        gap: 16px;
        margin: 16px 0;
      }

      .description {
        margin: 0;
        color: #666;
        font-size: 14px;
        line-height: 1.4;
      }

      .loading-container {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 12px;
        padding: 24px;
      }

      .captcha-container {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 12px;
        border: 1px solid #ddd;
        border-radius: 4px;
        background-color: #f9f9f9;
      }

      .captcha-image {
        max-width: 150px;
        height: auto;
        border: 1px solid #ccc;
        border-radius: 4px;
      }

      .full-width {
        width: 100%;
      }

      .error-message {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #f44336;
        font-size: 14px;
        padding: 8px;
        background-color: #ffebee;
        border-radius: 4px;
      }

      .info-message {
        display: flex;
        align-items: center;
        gap: 8px;
        color: #1976d2;
        font-size: 14px;
        padding: 8px;
        background-color: #e3f2fd;
        border-radius: 4px;
      }

      mat-dialog-actions {
        padding: 16px 0 0 0;
      }

      mat-spinner {
        margin-right: 8px;
      }
    `,
  ],
  changeDetection: ChangeDetectionStrategy.Eager,
  imports: [
    FormsModule,
    MatDialogModule,
    MatButtonModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressSpinnerModule,
    MatIconModule,
    MatTooltipModule
],
})
export class UniversityValidationDialogComponent {
  private universityValidationService = inject(UniversityValidationService);
  private snackBar = inject(MatSnackBar);
  private dialogRef = inject(MatDialogRef<UniversityValidationDialogComponent>);

  loading = signal(false);
  validating = signal(false);
  captchaImage = signal<string | null>(null);
  errorMessage = signal<string | null>(null);
  captchaCode = '';
  sessionId = signal<string | null>(null);
  private enrollmentNumber = signal<string | null>(null);

  // Cooldown signals
  cooldownActive = signal(false);
  cooldownRemaining = signal(0);
  private cooldownInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    @Inject(MAT_DIALOG_DATA) public data: UniversityValidationDialogData,
  ) {
    // Validate that we have a PDF file
    if (!data.pdfFile) {
      this.errorMessage.set(
        'Arquivo PDF não fornecido. Feche este diálogo e tente novamente com um arquivo válido.',
      );
      return;
    }

    // Sync cooldown status first
    this.syncCooldownWithBackend();

    // Immediately process PDF to extract auth code and get captcha
    this.processPdfAndGetCaptcha();
  }

  private async processPdfAndGetCaptcha(): Promise<void> {
    this.loading.set(true);
    this.errorMessage.set(null);

    try {
      // Process PDF to extract auth code and get initial captcha
      const response = await this.universityValidationService
        .getAtomicCaptcha(this.data.pdfFile)
        .toPromise();

      if (response) {
        // authCode is no longer sent to frontend for security - stored server-side only
        this.captchaImage.set(response.captchaImage);
        this.sessionId.set(response.sessionId);
      } else {
        throw new Error('Resposta vazia do servidor');
      }
    } catch (error: unknown) {
      console.error('Erro ao processar PDF:', error);
      console.error('Error details:', {
        status: (error as any)?.status,
        message: (error as any)?.message,
        errorMessage: (error as any)?.error?.message,
        errorObject: (error as any)?.error,
        fullError: JSON.stringify(error, null, 2),
      });

      // Categorize the error for the parent component
      let errorType = 'GENERIC_ERROR';
      let errorMessage =
        'Erro ao processar PDF. Tente fechar e abrir novamente.';

      const httpError = error as HttpErrorResponse;
      if (httpError.status === 400) {
        if (httpError.error?.message?.includes('PDF é obrigatório')) {
          errorType = 'PDF_REQUIRED';
          errorMessage = 'Arquivo PDF é obrigatório.';
        } else if (
          httpError.error?.message?.includes('Aguarde') &&
          httpError.error?.message?.includes('segundos')
        ) {
          // Handle cooldown error from backend
          errorType = 'COOLDOWN_ACTIVE';
          errorMessage =
            httpError.error?.message ||
            'Aguarde antes de solicitar um novo captcha';

          // Sync cooldown status from backend
          this.syncCooldownWithBackend();
        } else if (
          httpError.error?.message
            ?.toLowerCase()
            .includes('auth code not found') ||
          httpError.error?.message
            ?.toLowerCase()
            .includes('código de autenticidade não encontrado') ||
          httpError.error?.message
            ?.toLowerCase()
            .includes('código de autenticidade não encontrado no pdf') ||
          httpError.error?.message
            ?.toLowerCase()
            .includes('authentication code not found') ||
          httpError.error?.message?.toLowerCase().includes('autenticidade') ||
          httpError.message
            ?.toLowerCase()
            .includes('código de autenticidade não encontrado')
        ) {
          errorType = 'AUTH_CODE_NOT_FOUND';
          errorMessage =
            'Código de autenticidade não encontrado no PDF. Verifique se o documento é válido e contém um código de autenticidade.';
        } else if (httpError.error?.message?.includes('PDF')) {
          errorType = 'PDF_PROCESSING_ERROR';
          errorMessage = httpError.error?.message || 'Erro ao processar PDF.';
        } else {
          errorType = 'PDF_PROCESSING_ERROR';
          errorMessage = httpError.error?.message || 'Erro ao processar PDF.';
        }
      } else if (httpError.status === 0) {
        errorType = 'NETWORK_ERROR';
        errorMessage =
          'Erro de conectividade. Verifique sua conexão com a internet.';
      } else if (httpError.status >= 500) {
        errorType = 'NETWORK_ERROR';
        errorMessage = 'Erro no servidor. Tente novamente em alguns minutos.';
      } else {
        // For other HTTP errors, try to extract meaningful message
        if (httpError.error?.message) {
          if (httpError.error.message.includes('autenticidade')) {
            errorType = 'AUTH_CODE_NOT_FOUND';
            errorMessage = 'Código de autenticidade não encontrado no PDF.';
          } else {
            errorMessage = httpError.error.message;
          }
        }
      }

      // Handle cooldown errors differently - keep dialog open
      if (errorType === 'COOLDOWN_ACTIVE') {
        this.errorMessage.set(errorMessage);
        return; // Don't close dialog, just show the error message
      }

      // Close dialog and let parent handle the error display via banner
      this.dialogRef.close({
        success: false,
        error: errorMessage,
        errorType: errorType,
      });
    } finally {
      this.loading.set(false);
    }
  }

  private generateSessionId(): string {
    return Math.random().toString(36).substring(2) + Date.now().toString(36);
  }

  refreshCaptcha(): void {
    // Check if cooldown is active
    if (this.cooldownActive()) {
      return; // Button is disabled, but extra safety check
    }

    const currentSessionId = this.sessionId();
    if (!currentSessionId) {
      this.errorMessage.set('Sessão não encontrada. Reabra o diálogo.');
      return;
    }

    this.loading.set(true);
    this.errorMessage.set(null);

    this.universityValidationService
      .refreshCaptcha(currentSessionId)
      .subscribe({
        next: (response) => {
          this.loading.set(false);
          this.captchaImage.set(response.captchaImage);
          this.captchaCode = ''; // Clear the input
          this.syncCooldownWithBackend(); // Update cooldown state
        },
        error: (error) => {
          this.loading.set(false);
          console.error('Error refreshing captcha:', error);

          if (
            error.status === 400 &&
            error.error?.message?.includes('Aguarde')
          ) {
            // Handle cooldown error
            this.errorMessage.set(error.error.message);
            this.syncCooldownWithBackend();
          } else {
            this.errorMessage.set(
              'Erro ao atualizar captcha. Tente novamente.',
            );
          }
        },
      });
  }

  validateDocument(): void {
    if (!this.captchaCode.trim()) {
      this.errorMessage.set('Por favor, digite o código de segurança.');
      return;
    }

    // Check if cooldown is active
    if (this.cooldownActive()) {
      this.errorMessage.set(
        `Aguarde ${this.cooldownRemaining()} segundos antes de tentar novamente.`,
      );
      return;
    }

    const sessionIdValue = this.sessionId();
    if (!sessionIdValue) {
      this.errorMessage.set('Sessão não encontrada. Reabra o diálogo.');
      return;
    }

    this.validating.set(true);
    this.errorMessage.set(null);

    // Create the request body with only captchaCode and sessionId (authCode is stored server-side)
    const validationRequest = {
      captchaCode: this.captchaCode.trim(),
      sessionId: sessionIdValue, // Auth code is retrieved from server-side session
    };

    this.universityValidationService
      .validateDocumentAtomicWithData(validationRequest)
      .subscribe({
        next: (result: AtomicValidationResponse) => {
          this.validating.set(false);

          if (result.success) {
            if (result.valid) {
              this.snackBar.open(
                'Documento validado com sucesso na universidade!',
                'Fechar',
                { duration: 5000 },
              );
              this.dialogRef.close({ success: true, validated: true });
            } else if (result.valid === false) {
              // Close dialog and let parent show error banner
              this.dialogRef.close({
                success: false,
                error:
                  'Documento não encontrado ou inválido na base universitária.',
                errorType: 'INVALID_DOCUMENT',
              });
            } else {
              this.snackBar.open(
                result.message || 'Documento encontrado na universidade.',
                'Fechar',
                { duration: 3000 },
              );
              this.dialogRef.close({ success: true, validated: true });
            }
          } else {
            // Check if this is a captcha error (keep modal open) or other error (close and show banner)
            const isCaptchaError =
              result.message?.includes('Captcha incorreto') ||
              result.message?.includes('código de segurança') ||
              result.needsCaptcha;

            if (isCaptchaError) {
              // Keep modal open for captcha errors - user can retry
              if (result.captchaImage) {
                this.captchaImage.set(result.captchaImage);
              }
              if (result.enrollmentNumber) {
                this.enrollmentNumber.set(result.enrollmentNumber);
              }
              this.errorMessage.set(
                result.message ||
                  'Código de segurança inválido. Tente novamente.',
              );
              this.captchaCode = ''; // Clear captcha input for retry

              // Sync cooldown status after failed captcha attempt
              this.syncCooldownWithBackend();
            } else {
              // Non-captcha errors: close modal and show banner
              let errorType = 'GENERIC_ERROR';
              if (result.message?.includes('matrícula não encontrada')) {
                errorType = 'ENROLLMENT_NOT_FOUND';
              } else if (result.message?.includes('código de autenticidade')) {
                errorType = 'AUTH_CODE_NOT_FOUND';
              } else if (
                result.message?.includes('conectividade') ||
                result.message?.includes('rede')
              ) {
                errorType = 'NETWORK_ERROR';
              }

              this.dialogRef.close({
                success: false,
                error: result.message || 'Erro na validação.',
                errorType: errorType,
              });
            }
          }
        },
        error: (error: HttpErrorResponse) => {
          console.error('Validation error:', error);
          this.validating.set(false);

          // Close dialog and show banner for network/server errors
          const errorType = 'NETWORK_ERROR';
          let errorMessage = 'Erro interno. Tente novamente.';

          if (error.status === 0) {
            errorMessage =
              'Erro de conectividade. Verifique sua conexão com a internet.';
          } else if (error.status >= 500) {
            errorMessage =
              'Erro no servidor. Tente novamente em alguns minutos.';
          }

          this.dialogRef.close({
            success: false,
            error: errorMessage,
            errorType: errorType,
          });
        },
      });
  }

  private startCooldownTimer(seconds: number): void {
    this.cooldownActive.set(true);
    this.cooldownRemaining.set(seconds);

    // Clear any existing interval
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
    }

    // Start countdown
    this.cooldownInterval = setInterval(() => {
      const remaining = this.cooldownRemaining();
      if (remaining <= 1) {
        this.stopCooldownTimer();
      } else {
        this.cooldownRemaining.set(remaining - 1);
      }
    }, 1000);
  }

  private stopCooldownTimer(): void {
    this.cooldownActive.set(false);
    this.cooldownRemaining.set(0);
    if (this.cooldownInterval) {
      clearInterval(this.cooldownInterval);
      this.cooldownInterval = null;
    }
  }

  private async syncCooldownWithBackend(): Promise<void> {
    try {
      const cooldownStatus = await this.universityValidationService
        .getCooldownStatus()
        .toPromise();

      if (cooldownStatus?.inCooldown && cooldownStatus.remainingSeconds > 0) {
        this.startCooldownTimer(cooldownStatus.remainingSeconds);
      } else {
        this.stopCooldownTimer();
      }
    } catch (error) {
      console.warn('Failed to sync cooldown status:', error);
      // Don't block the UI if cooldown sync fails
    }
  }

  onCancel(): void {
    // Clean up cooldown timer
    this.stopCooldownTimer();
    this.dialogRef.close({ success: false });
  }
}
