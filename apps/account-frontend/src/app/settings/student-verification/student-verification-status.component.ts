import { Component, inject, OnInit, signal } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatChipsModule } from '@angular/material/chips';
import { RouterLink } from '@angular/router';
import { CommonModule } from '@angular/common';
import {
  StudentVerificationService,
  VerificationStatus,
} from '../../shared/services/student-verification/student-verification.service';

@Component({
  selector: 'app-student-verification-status',
  templateUrl: './student-verification-status.component.html',
  styleUrls: ['./student-verification-status.component.scss'],
  imports: [
    MatIconModule,
    MatButtonModule,
    MatCardModule,
    MatToolbarModule,
    MatChipsModule,
    RouterLink,
    CommonModule,
  ],
})
export class StudentVerificationStatusComponent implements OnInit {
  private studentVerificationService = inject(StudentVerificationService);

  verificationStatus = signal<VerificationStatus | null>(null);
  loading = signal(true);

  ngOnInit(): void {
    this.loadVerificationStatus();
  }

  loadVerificationStatus(): void {
    this.loading.set(true);
    this.studentVerificationService.getVerificationStatus().subscribe({
      next: (status: VerificationStatus) => {
        this.verificationStatus.set(status);
        this.loading.set(false);
      },
      error: () => {
        this.loading.set(false);
      },
    });
  }

  getStatusColor(status: string): string {
    switch (status) {
      case 'approved':
        return 'success';
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
        return 'Aprovado';
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
}
