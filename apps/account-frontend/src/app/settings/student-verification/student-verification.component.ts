import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSnackBar } from '@angular/material/snack-bar';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  UploadResponse,
  StudentVerificationService,
  VerificationStatus,
} from '../../shared/services/student-verification/student-verification.service';
import { MatDialog } from '@angular/material/dialog';
import { UniversityValidationDialogComponent } from '../../university-validation-dialog/university-validation-dialog.component';
import { environment } from '../../../environments/environment';

type BannerType = 'success' | 'error' | 'warning' | 'info';

interface BannerConfig {
  type: BannerType;
  title: string;
  message: string;
  icon: string;
  visible: boolean;
  dismissible?: boolean;
}

@Component({
  selector: 'app-student-verification',
  templateUrl: './student-verification.component.html',
  styleUrls: ['./student-verification.component.scss'],
  imports: [
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatToolbarModule,
    MatProgressBarModule,
    MatTooltipModule,
    MatCheckboxModule,
    RouterLink,
    CommonModule,
  ],
})
export class StudentVerificationComponent implements OnInit {
  private studentVerificationService = inject(StudentVerificationService);
  private snackBar = inject(MatSnackBar);
  private dialog = inject(MatDialog);

  selectedFile = signal<File | null>(null);
  uploading = signal(false);
  verificationStatus = signal<VerificationStatus | null>(null);
  verificationNotRequired = computed(
    () => this.verificationStatus()?.status === 'not_required',
  );

  // Development mode properties
  isDevelopment = !environment.production;
  useManualFallback = signal(false);
  uploadProgress = signal(0);

  // Banner system
  currentBanner = signal<BannerConfig | null>(null);
  private bannerTimeout?: number;

  private showBanner(
    type: BannerType,
    title: string,
    message: string,
    dismissible = true,
    autoHide = false,
  ): void {
    // Clear any existing timeout
    if (this.bannerTimeout) {
      clearTimeout(this.bannerTimeout);
    }

    this.currentBanner.set({
      type,
      title,
      message,
      icon: this.getBannerIcon(type),
      visible: true,
      dismissible,
    });

    // Auto-hide banner after 5 seconds for success/info messages
    if (autoHide) {
      this.bannerTimeout = window.setTimeout(() => {
        this.dismissBanner();
      }, 5000);
    }
  }

  private getBannerIcon(type: BannerType): string {
    switch (type) {
      case 'success':
        return 'check_circle';
      case 'error':
        return 'error';
      case 'warning':
        return 'warning';
      case 'info':
        return 'info';
      default:
        return 'info';
    }
  }

  dismissBanner(): void {
    if (this.bannerTimeout) {
      clearTimeout(this.bannerTimeout);
      this.bannerTimeout = undefined;
    }
    this.currentBanner.set(null);
  }

  private showSuccessBanner(title: string, message: string): void {
    this.showBanner('success', title, message, true, true);
  }

  private showErrorBanner(title: string, message: string): void {
    this.showBanner('error', title, message);
  }

  private showWarningBanner(title: string, message: string): void {
    this.showBanner('warning', title, message);
  }

  private showInfoBanner(title: string, message: string): void {
    this.showBanner('info', title, message);
  }

  ngOnInit(): void {
    this.studentVerificationService.getVerificationStatus().subscribe({
      next: (status) => {
        this.verificationStatus.set(status);
        if (status.status === 'not_required') {
          this.showInfoBanner(
            'Verificação dispensada',
            'A verificação de estudantes da graduação está temporariamente desativada.',
          );
        }
      },
    });
  }

  onFileSelected(event: Event): void {
    const target = event.target as HTMLInputElement;
    if (target.files && target.files.length > 0) {
      const file = target.files[0];

      // Dismiss any existing banner when user selects a new file
      this.dismissBanner();

      // Validate file type
      const allowedTypes = ['application/pdf'];
      if (!allowedTypes.includes(file.type)) {
        this.showErrorBanner(
          'Tipo de arquivo inválido',
          'Tipo de arquivo não suportado. Use PDF.',
        );
        return;
      }

      // Validate file size (10MB max)
      const maxSize = 10 * 1024 * 1024;
      if (file.size > maxSize) {
        this.showErrorBanner(
          'Arquivo muito grande',
          'Arquivo muito grande. Tamanho máximo: 10MB.',
        );
        return;
      }

      this.selectedFile.set(file);
    }
  }

  uploadDocument(): void {
    if (this.verificationNotRequired()) {
      this.showInfoBanner(
        'Verificação dispensada',
        'A verificação de estudantes da graduação está temporariamente desativada.',
      );
      return;
    }

    const file = this.selectedFile();
    if (!file) {
      this.snackBar.open('Selecione um arquivo primeiro.', 'Fechar', {
        duration: 3000,
      });
      return;
    }

    this.uploading.set(true);
    this.uploadProgress.set(0);

    // Use manual fallback if development toggle is checked
    const isManualFallback = this.isDevelopment && this.useManualFallback();

    if (isManualFallback) {
      this.snackBar.open(
        'Modo de desenvolvimento: Pulando validação automática para aprovação manual.',
        'Fechar',
        { duration: 4000 },
      );
    }

    this.studentVerificationService
      .uploadDocument(file, isManualFallback)
      .subscribe({
        next: (response: UploadResponse) => {
          this.uploading.set(false);
          this.selectedFile.set(null);

          if (response.status === 'rejected') {
            this.showErrorBanner(
              'Documento rejeitado',
              response.message || 'Documento rejeitado automaticamente.',
            );
            return;
          }

          const message =
            response.message ||
            (isManualFallback
              ? 'Documento enviado diretamente para aprovação manual!'
              : 'Documento enviado com sucesso! Aguarde a verificação.');

          this.snackBar.open(message, 'Fechar', {
            duration: 5000,
          });
        },
        error: (error: HttpErrorResponse) => {
          this.uploading.set(false);
          this.snackBar.open(
            error.error?.message ||
              'Erro ao enviar documento. Tente novamente.',
            'Fechar',
            { duration: 5000 },
          );
        },
      });
  }

  removeSelectedFile(): void {
    this.selectedFile.set(null);
    // Dismiss banner when file is removed
    this.dismissBanner();
  }

  formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  openUniversityValidation(): void {
    if (this.verificationNotRequired()) {
      this.showInfoBanner(
        'Verificação dispensada',
        'A verificação de estudantes da graduação está temporariamente desativada.',
      );
      return;
    }

    const file = this.selectedFile();

    if (!file) {
      this.showErrorBanner(
        'Arquivo requerido',
        'Por favor, selecione um arquivo PDF primeiro.',
      );
      return;
    }

    // If development mode and manual fallback is checked, upload directly
    if (this.isDevelopment && this.useManualFallback()) {
      this.uploadDocument();
      return;
    }

    if (file.type !== 'application/pdf') {
      this.showErrorBanner(
        'Tipo de arquivo inválido',
        'Apenas arquivos PDF são suportados para validação universitária.',
      );
      return;
    }

    const dialogRef = this.dialog.open(UniversityValidationDialogComponent, {
      width: '500px',
      disableClose: true,
      data: {
        pdfFile: file,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result?.success && result?.validated) {
        this.showSuccessBanner(
          'Validação concluída',
          'Documento validado com sucesso na universidade!',
        );
      } else if (result?.error) {
        // Handle different error types
        this.handleValidationError(result.error, result.errorType);
      }
    });
  }

  private handleValidationError(error: string, errorType?: string): void {
    // Categorize errors and show appropriate banners
    if (errorType === 'COOLDOWN_ACTIVE') {
      this.showInfoBanner(
        'Aguarde para tentar novamente',
        error || 'Aguarde alguns segundos antes de tentar novamente.',
      );
    } else if (errorType === 'PDF_PROCESSING_ERROR') {
      this.showErrorBanner(
        'Erro no processamento do PDF',
        'Não foi possível processar o arquivo PDF. Verifique se o arquivo é válido e não está corrompido.',
      );
    } else if (errorType === 'AUTH_CODE_NOT_FOUND') {
      this.showErrorBanner(
        'Código de autenticidade não encontrado',
        'O documento PDF não contém um código de autenticidade válido.',
      );
    } else if (errorType === 'NETWORK_ERROR') {
      this.showWarningBanner(
        'Ocorreu um erro',
        'Problema com o servidor do CACiC. Tente novamente em alguns minutos ou entre em contato.',
      );
    } else if (errorType === 'UNESP_NETWORK_ERROR') {
      this.showWarningBanner(
        'Erro de conectividade',
        'Problema de conexão com o servidor da universidade. Tente novamente em alguns minutos.',
      );
    } else if (errorType === 'ENROLLMENT_NOT_FOUND') {
      this.showErrorBanner(
        'Matrícula não encontrada',
        'O número de matrícula não foi encontrado no sistema da universidade.',
      );
    } else if (errorType === 'INVALID_DOCUMENT') {
      this.showErrorBanner(
        'Documento inválido',
        'O documento não confere com os dados cadastrados.',
      );
    } else {
      // Generic error
      this.showErrorBanner(
        'Erro na validação',
        error || 'Ocorreu um erro durante a validação. Tente novamente.',
      );
    }
  }
}
