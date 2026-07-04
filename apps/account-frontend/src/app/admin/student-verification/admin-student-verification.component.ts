import { Component, inject, OnInit, signal } from '@angular/core';
import { MatTableModule } from '@angular/material/table';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialogModule } from '@angular/material/dialog';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatSnackBar } from '@angular/material/snack-bar';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import type { StudentVerificationDocument as StudentDocument } from '@cacic/shared-types';
import { StudentVerificationService } from '../../shared/services/student-verification/student-verification.service';
import { MatDialog } from '@angular/material/dialog';
import { RejectDocumentDialogComponent } from './reject-document-dialog.component';
import { environment } from '../../../environments/environment';
import { LoggerService } from '../../shared/services/logger.service';

@Component({
  selector: 'app-admin-student-verification',
  templateUrl: './admin-student-verification.component.html',
  styleUrls: ['./admin-student-verification.component.scss'],
  imports: [
    MatTableModule,
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatToolbarModule,
    MatChipsModule,
    MatDialogModule,
    MatTooltipModule,
    CommonModule,
    RouterLink,
  ],
})
export class AdminStudentVerificationComponent implements OnInit {
  private studentVerificationService = inject(StudentVerificationService);
  private dialog = inject(MatDialog);
  private snackBar = inject(MatSnackBar);
  private http = inject(HttpClient);
  private logger = inject(LoggerService);

  documents = signal<StudentDocument[]>([]);
  loading = signal(true);

  displayedColumns: string[] = ['fullName', 'email', 'fileName', 'authCode', 'submissionDate', 'status', 'actions'];

  ngOnInit(): void {
    this.loadPendingDocuments();
  }

  loadPendingDocuments(): void {
    this.loading.set(true);
    this.studentVerificationService.getPendingDocuments().subscribe({
      next: (documents) => {
        this.documents.set(documents);
        this.loading.set(false);
      },
      error: (error) => {
        this.logger.error('Error loading student verification documents', error);
        this.documents.set([]);
        this.loading.set(false);
      },
    });
  }

  downloadDocument(documentId: string): void {
    const downloadUrl = `${environment.apiUrl}/student-verification/admin/${documentId}/download`;

    this.http
      .get(downloadUrl, {
        responseType: 'blob',
        observe: 'response',
        withCredentials: true,
      })
      .subscribe({
        next: (response) => {
          // Extract filename from Content-Disposition header or use fallback
          const contentDisposition = response.headers.get('Content-Disposition');
          let filename = `documento-${documentId}.pdf`;

          if (contentDisposition) {
            const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
            if (filenameMatch && filenameMatch[1]) {
              filename = filenameMatch[1].replace(/['"]/g, '');
              // Decode URI encoded filenames properly
              try {
                filename = decodeURIComponent(filename);
              } catch (e) {
                // Keep original filename if decoding fails
              }
            }
          }

          // Create blob and download
          const blob = response.body;
          if (blob) {
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            link.style.display = 'none';
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            window.URL.revokeObjectURL(url);

            this.snackBar.open('Documento baixado com sucesso', 'Fechar', {
              duration: 3000,
            });
          }
        },
        error: (error) => {
          this.logger.error('Error downloading student verification document', error);
          this.snackBar.open('Erro ao baixar documento. Tente novamente.', 'Fechar', { duration: 5000 });
        },
      });
  }

  approveDocument(documentId: string): void {
    this.studentVerificationService.approveDocument(documentId).subscribe({
      next: () => {
        this.snackBar.open('Documento aprovado com sucesso', 'Fechar', {
          duration: 3000,
        });
        this.loadPendingDocuments(); // Reload the list
      },
      error: (error) => {
        this.logger.error('Error approving student verification document', error);
        this.snackBar.open('Erro ao aprovar documento. Tente novamente.', 'Fechar', { duration: 5000 });
      },
    });
  }

  rejectDocument(documentId: string): void {
    const dialogRef = this.dialog.open(RejectDocumentDialogComponent, {
      width: '500px',
      disableClose: true,
    });

    dialogRef.afterClosed().subscribe((reason: string | null) => {
      if (reason) {
        this.studentVerificationService.rejectDocument(documentId, reason).subscribe({
          next: () => {
            this.snackBar.open('Documento rejeitado com sucesso', 'Fechar', {
              duration: 3000,
            });
            this.loadPendingDocuments(); // Reload the list
          },
          error: (error) => {
            this.logger.error('Error rejecting student verification document', error);
            this.snackBar.open('Erro ao rejeitar documento. Tente novamente.', 'Fechar', { duration: 5000 });
          },
        });
      }
    });
  }

  openUniversityVerification(authCode: string): void {
    if (authCode) {
      const url = this.studentVerificationService.getUniversityVerificationUrl(authCode);
      window.open(url, '_blank');
    }
  }

  getStatusColor(status: string): 'primary' | 'accent' | 'warn' {
    switch (status) {
      case 'approved':
        return 'primary';
      case 'rejected':
        return 'warn';
      default:
        return 'accent';
    }
  }

  getStatusText(status: string): string {
    switch (status) {
      case 'approved':
        return 'Aprovado';
      case 'rejected':
        return 'Rejeitado';
      case 'pending':
        return 'Pendente';
      default:
        return status;
    }
  }
}
