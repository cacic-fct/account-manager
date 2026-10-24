import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatDialog } from '@angular/material/dialog';
import { MatChipsModule } from '@angular/material/chips';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Location } from '@angular/common';
import {
  StudentVerificationService,
  VerificationStatus,
  UploadResponse,
} from '../../../shared/services/student-verification/student-verification.service';
import { environment } from '../../../../environments/environment';
import { UniversityValidationDialogComponent } from '../components/university-validation-dialog/university-validation-dialog.component';
import { TransientBannerController } from '../../../shared/ui/transient-banner.controller';
import { LoggerService } from '../../../shared/services/logger.service';
import { formatLocalizedDate } from '../../../shared/utils/date-fns';
import { getApiErrorMessage } from '../../../shared/utils/api-error-message';

@Component({
  selector: 'app-student-verification-details',
  imports: [
    FormsModule,
    RouterModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatChipsModule,
    MatProgressBarModule,
    MatToolbarModule,
  ],
  templateUrl: './verification-details.component.html',
  styleUrl: './verification-details.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVerificationDetailsComponent implements OnInit, OnDestroy {
  private verificationService = inject(StudentVerificationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private location = inject(Location);
  private logger = inject(LoggerService);

  isLoading = signal(false);
  uploading = signal(false);
  hasLoadError = signal(false);
  loadErrorMessage = signal('');
  verificationStatus = signal<VerificationStatus | null>(null);

  selectedFile = signal<File | null>(null);
  isDragOver = signal(false);
  useManualFallback = signal(false);
  hasAttemptedValidation = signal(false);

  isDevelopment = !environment.production;

  private banners = new TransientBannerController();
  currentBanner = this.banners.currentBanner;

  ngOnInit(): void {
    this.loadVerificationStatus();
  }

  ngOnDestroy(): void {
    this.banners.destroy();
  }

  dismissBanner(): void {
    this.banners.dismiss();
  }

  loadVerificationStatus(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);
    this.loadErrorMessage.set('');

    this.verificationService.getVerificationStatus().subscribe({
      next: (status) => {
        this.verificationStatus.set(status);
        this.isLoading.set(false);
        this.hasLoadError.set(false);
        this.loadErrorMessage.set('');
      },
      error: (error) => {
        this.logger.error('Error loading verification status', error, { operation: 'student-verification' });
        this.hasLoadError.set(true);
        this.isLoading.set(false);
        this.verificationStatus.set(null);
        this.loadErrorMessage.set(
          getApiErrorMessage(error, 'Não foi possível carregar o status da sua verificação. Tente novamente.'),
        );
      },
    });
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file && this.isValidFile(file)) {
      this.selectedFile.set(file);
      // Auto-upload when file is selected
      this.startValidation();
    } else if (file) {
      this.banners.showError('Arquivo inválido', 'Por favor, selecione um arquivo PDF válido.');
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    this.isDragOver.set(false);

    const files = event.dataTransfer?.files;
    const file = files?.[0];
    if (file && this.isValidFile(file)) {
      this.selectedFile.set(file);
      // Auto-upload when file is dropped
      this.startValidation();
    } else if (file) {
      this.banners.showError('Arquivo inválido', 'Por favor, selecione um arquivo PDF válido.');
    }
  }

  removeSelectedFile(): void {
    this.selectedFile.set(null);
  }

  private isValidFile(file: File): boolean {
    const validTypes = ['application/pdf'];
    const maxSize = 10 * 1024 * 1024; // 10MB
    return validTypes.includes(file.type) && file.size <= maxSize;
  }

  startValidation(): void {
    const file = this.selectedFile();

    if (!file) {
      this.banners.showError('Arquivo não selecionado', 'Por favor, selecione um arquivo PDF.');
      return;
    }

    this.hasAttemptedValidation.set(true);

    // If development mode and manual fallback is checked, upload directly
    if (this.isDevelopment && this.useManualFallback()) {
      this.uploadDocument();
      return;
    }

    // Otherwise, open university validation dialog
    const dialogRef = this.dialog.open(UniversityValidationDialogComponent, {
      width: '500px',
      disableClose: true,
      data: {
        pdfFile: file,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.pendingManualReview) {
        this.banners.showInfo('Documento enviado', 'Seu documento foi encaminhado para análise manual.');
        this.loadVerificationStatus();
        this.selectedFile.set(null);
        this.hasAttemptedValidation.set(false);
      } else if (result?.success) {
        this.banners.showSuccess('Documento validado', 'Documento verificado com sucesso pela universidade!');
        this.loadVerificationStatus(); // Reload status after successful validation
        this.selectedFile.set(null); // Clear selected file
        this.hasAttemptedValidation.set(false); // Reset attempt flag
      } else if (result?.error) {
        this.handleValidationError(result.error, result.errorType);
      }
    });
  }

  private uploadDocument(): void {
    const file = this.selectedFile();
    if (!file) return;

    this.uploading.set(true);

    // Use manual fallback if development toggle is checked
    const isManualFallback = this.isDevelopment && this.useManualFallback();

    this.verificationService.uploadDocument(file, isManualFallback).subscribe({
      next: (response: UploadResponse) => {
        this.handleUploadSuccess(response);
      },
      error: (error: unknown) => {
        this.handleUploadError(error);
      },
    });
  }

  private handleUploadSuccess(response: UploadResponse): void {
    this.uploading.set(false);
    this.selectedFile.set(null);

    if (response.status === 'approved') {
      this.banners.showSuccess('Documento aprovado!', 'Sua verificação como estudante foi aprovada.');
    } else if (response.status === 'pending') {
      this.banners.showInfo('Documento enviado', 'Seu documento foi enviado e está em análise.');
    } else {
      this.banners.showError('Documento rejeitado', response.message || 'Documento rejeitado automaticamente.');
    }

    this.loadVerificationStatus();
  }

  private handleValidationError(error: string, errorType?: string): void {
    let title = 'Erro na validação';
    let message = error;

    switch (errorType) {
      case 'network':
      case 'NETWORK_ERROR':
        title = 'Não foi possível concluir a validação';
        message = error || 'Tente validar o documento novamente em alguns instantes.';
        break;
      case 'validation':
        title = 'Falha na validação';
        break;
      case 'captcha':
      case 'CAPTCHA_ERROR':
        title = 'Erro no captcha';
        break;
      case 'UNESP_NETWORK_ERROR':
        title = 'Erro de conexão com a universidade';
        message = 'Não foi possível consultar o sistema da universidade. Tente novamente em alguns instantes.';
        break;
      case 'PDF_PROCESSING_ERROR':
        title = 'Não foi possível processar o PDF';
        break;
      case 'AUTH_CODE_NOT_FOUND':
        title = 'Código de autenticidade não encontrado';
        break;
      case 'ENROLLMENT_NOT_FOUND':
        title = 'Registro acadêmico (RA) não encontrado';
        break;
      case 'INVALID_DOCUMENT':
        title = 'Documento inválido';
        break;
      case 'COOLDOWN_ACTIVE':
        title = 'Aguarde para tentar novamente';
        break;
      default:
        title = 'Erro na validação';
        break;
    }

    this.banners.showError(title, message);
  }

  private handleUploadError(error: unknown): void {
    this.uploading.set(false);
    this.logger.error('Upload error', error, { operation: 'student-verification-upload' });
    const errorMessage = getApiErrorMessage(
      error,
      'Não foi possível enviar o documento. Selecione um PDF válido de até 10 MB e tente novamente.',
    );
    this.banners.showError('Erro no upload', errorMessage);
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'approved':
        return 'primary';
      case 'pending':
        return 'accent';
      case 'rejected':
        return 'warn';
      default:
        return 'primary';
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'approved':
        return 'verified';
      case 'pending':
        return 'schedule';
      case 'rejected':
        return 'cancel';
      default:
        return 'help';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'approved':
        return 'Aprovado';
      case 'pending':
        return 'Em análise';
      case 'rejected':
        return 'Rejeitado';
      case 'not_submitted':
        return 'Não enviado';
      default:
        return 'Desconhecido';
    }
  }

  formatDate(date: Date | string | null | undefined): string {
    if (!date) {
      return 'Data não disponível';
    }

    return formatLocalizedDate(date, 'PPP', 'Data inválida');
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  goBack(): void {
    this.location.back();
  }
}
