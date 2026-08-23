import { ChangeDetectionStrategy, Component, OnDestroy, OnInit, inject, signal } from '@angular/core';

import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
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
import {
  StudentVerificationService,
  VerificationStatus,
  UploadResponse,
} from '../../../shared/services/student-verification/student-verification.service';
import { UniversityValidationDialogComponent } from './university-validation-dialog/university-validation-dialog.component';
import { environment } from '../../../../environments/environment';
import { RouterLink } from '@angular/router';
import { TransientBannerController } from '../../../shared/ui/transient-banner.controller';
import { LoggerService } from '../../../shared/services/logger.service';

@Component({
  selector: 'app-student-verification-card',
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatProgressSpinnerModule,
    MatTooltipModule,
    MatCheckboxModule,
    MatChipsModule,
    MatProgressBarModule,
    RouterLink,
  ],
  templateUrl: './student-verification-card.component.html',
  styleUrl: './student-verification-card.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class StudentVerificationCardComponent implements OnInit, OnDestroy {
  private studentVerificationService = inject(StudentVerificationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);
  private logger = inject(LoggerService);

  isLoading = signal(false);
  hasLoadError = signal(false);
  verificationStatus = signal<VerificationStatus | null>(null);
  uploading = signal(false);
  selectedFile = signal<File | null>(null);
  isDragOver = signal(false);
  hasAttemptedValidation = signal(false);

  // Development mode properties
  isDevelopment = !environment.production;
  useManualFallback = signal(false);

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

  private showSuccessBanner(title: string, message: string): void {
    this.banners.showSuccess(title, message);
  }

  private showErrorBanner(title: string, message: string): void {
    this.banners.showError(title, message);
  }

  private showWarningBanner(title: string, message: string): void {
    this.banners.showWarning(title, message);
  }

  private showInfoBanner(title: string, message: string): void {
    this.banners.showInfo(title, message);
  }

  loadVerificationStatus(): void {
    this.isLoading.set(true);
    this.hasLoadError.set(false);

    this.studentVerificationService.getVerificationStatus().subscribe({
      next: (status: VerificationStatus) => {
        this.verificationStatus.set(status);
        this.isLoading.set(false);
        this.updateBannerBasedOnStatus();
      },
      error: (error) => {
        this.logger.error('Error loading verification status', error, { operation: 'student-verification' });
        this.hasLoadError.set(true);
        this.isLoading.set(false);
        this.showErrorBanner(
          'Erro de conexão',
          'Não foi possível carregar o status de verificação. Verifique sua conexão.',
        );
      },
    });
  }

  private updateBannerBasedOnStatus(): void {
    // Only show status banner if there's no current error/success/warning banner
    const currentType = this.currentBanner()?.type;
    const hasImportantBanner = currentType && ['error', 'success', 'warning'].includes(currentType);

    if (!hasImportantBanner) {
      const status = this.verificationStatus();
      if (status?.status === 'not_required') {
        this.showInfoBanner(
          'Verificação dispensada',
          'A verificação de estudantes da graduação está temporariamente desativada.',
        );
      } else if (status?.status === 'not_submitted') {
        this.showInfoBanner(
          'Verificação pendente',
          'Envie um documento válido para verificar seu status de estudante.',
        );
      }
    }
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];
      this.handleFileSelection(file);
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
    if (files && files.length > 0) {
      const file = files[0];
      this.handleFileSelection(file);
    }
  }

  private handleFileSelection(file: File): void {
    if (file.type !== 'application/pdf') {
      this.showErrorBanner('Formato inválido', 'Por favor, selecione apenas arquivos PDF.');
      return;
    }

    if (file.size > 10 * 1024 * 1024) {
      // 10MB limit
      this.showErrorBanner('Arquivo muito grande', 'O arquivo deve ter no máximo 10MB.');
      return;
    }

    this.selectedFile.set(file);
    this.dismissBanner(); // Clear any existing banners when file is selected

    // Auto-submit file after a short delay to allow user to see the selection
    setTimeout(() => {
      this.startValidation();
    }, 500);
  }

  removeSelectedFile(): void {
    this.selectedFile.set(null);
    this.hasAttemptedValidation.set(false);
    this.dismissBanner();
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  startValidation(): void {
    const file = this.selectedFile();

    if (!file) {
      this.showErrorBanner('Arquivo não selecionado', 'Por favor, selecione um arquivo PDF.');
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
        this.showSuccessBanner('Documento enviado', 'Seu documento foi encaminhado para análise manual.');
        this.loadVerificationStatus();
        this.selectedFile.set(null);
        this.hasAttemptedValidation.set(false);
      } else if (result?.success) {
        this.showSuccessBanner('Documento validado', 'Documento verificado com sucesso pela universidade!');
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

    this.studentVerificationService.uploadDocument(file, isManualFallback).subscribe({
      next: (response: UploadResponse) => {
        this.uploading.set(false);

        if (response.status === 'approved') {
          this.showSuccessBanner('Documento aprovado', 'Seu documento foi verificado e aprovado automaticamente!');
        } else if (response.status === 'rejected') {
          this.showErrorBanner('Documento rejeitado', response.message || 'Documento foi rejeitado automaticamente.');
        } else {
          this.showSuccessBanner('Documento enviado', 'Documento enviado com sucesso! Aguarde a verificação manual.');
        }

        this.loadVerificationStatus();
        this.selectedFile.set(null);
        this.hasAttemptedValidation.set(false); // Reset attempt flag on success
      },
      error: (error: HttpErrorResponse) => {
        this.uploading.set(false);
        this.logger.error('Upload error', error, { operation: 'student-verification-upload' });

        let errorMessage = 'Erro ao enviar documento. Tente novamente.';
        if (error?.error?.message) {
          errorMessage = error.error.message;
        }

        this.showErrorBanner('Erro no envio', errorMessage);
      },
    });
  }

  private handleValidationError(error: string, errorType?: string): void {
    let title = 'Erro na validação';
    let message = error;

    switch (errorType) {
      case 'network':
        title = 'Erro de conexão';
        message = 'Verifique sua conexão e tente novamente.';
        break;
      case 'validation':
        title = 'Falha na validação';
        break;
      case 'captcha':
        title = 'Erro no captcha';
        break;
      default:
        title = 'Erro na validação';
        break;
    }

    this.showErrorBanner(title, message);
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'approved':
        return 'primary'; // Will show as success color
      case 'rejected':
        return 'warn';
      case 'pending':
        return 'accent';
      default:
        return 'primary';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'approved':
        return 'Verificado';
      case 'rejected':
        return 'Rejeitado';
      case 'pending':
        return 'Aguardando verificação';
      case 'not_submitted':
        return 'Não enviado';
      case 'not_required':
        return 'Não necessária';
      default:
        return status;
    }
  }

  getStatusIcon(status: string): string {
    switch (status) {
      case 'approved':
        return 'check_circle';
      case 'rejected':
        return 'cancel';
      case 'pending':
        return 'schedule';
      case 'not_submitted':
        return 'upload_file';
      case 'not_required':
        return 'verified_user';
      default:
        return 'help';
    }
  }

  formatDate(date: string | Date): string {
    if (!date) return '';
    const d = typeof date === 'string' ? new Date(date) : date;
    return d.toLocaleDateString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
}
