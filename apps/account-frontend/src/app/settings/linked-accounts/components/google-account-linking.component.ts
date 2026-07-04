import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountMergeRequest } from '@cacic/shared-types';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';

@Component({
  selector: 'app-google-account-linking',
  imports: [
    FormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './google-account-linking.component.html',
  styleUrl: './google-account-linking.component.scss',
})
export class GoogleAccountLinkingComponent implements OnInit, OnDestroy {
  private readonly apiService = inject(ApiService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);

  protected readonly currentUser = this.authService.currentUser;
  protected readonly isLoading = signal(false);
  protected readonly isConfirming = signal(false);
  protected readonly mergeRequest = signal<AccountMergeRequest | null>(null);
  protected readonly selectedPrimaryEmail = signal('');
  private activeMergeRequestId = '';
  private pollTimer?: number;
  protected readonly primaryScore = computed(() => {
    const request = this.mergeRequest();
    return request?.scores.find((score) => score.userId === request.primaryUserId);
  });
  protected readonly secondaryScore = computed(() => {
    const request = this.mergeRequest();
    return request?.scores.find((score) => score.userId === request.secondaryUserId);
  });

  ngOnInit(): void {
    this.route.queryParamMap.subscribe((params) => {
      const status = params.get('accountLink');
      const requestId = params.get('merge_request');

      if (status === 'already-linked') {
        this.snackBar.open('Essa conta Google já está vinculada.', 'OK', {
          duration: 5000,
        });
        this.clearQueryParams();
      }

      if (status === 'failed') {
        this.snackBar.open('Não foi possível vincular a conta Google.', 'OK', {
          duration: 7000,
        });
        this.clearQueryParams();
      }

      if (requestId) {
        this.loadMergeRequest(requestId);
      }
    });
  }

  ngOnDestroy(): void {
    this.stopPolling();
  }

  protected startLinking(): void {
    this.isLoading.set(true);
    this.apiService.startGoogleAccountLinking().subscribe({
      next: ({ url }) => {
        window.location.href = url;
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Não foi possível iniciar o vínculo.', 'OK', {
          duration: 7000,
        });
      },
    });
  }

  protected confirmMerge(): void {
    const request = this.mergeRequest();
    const primaryEmail = this.selectedPrimaryEmail();

    if (!request || !primaryEmail) {
      return;
    }

    this.isConfirming.set(true);
    this.apiService.confirmAccountMerge(request.id, { primaryEmail }).subscribe({
      next: (response) => {
        this.isConfirming.set(false);
        this.mergeRequest.set(response.request);
        this.startPolling(response.request.id);
        this.snackBar.open('Unificação iniciada. Vamos acompanhar por aqui.', 'OK', {
          duration: 6000,
        });
      },
      error: () => {
        this.isConfirming.set(false);
        this.snackBar.open('Não foi possível concluir a unificação.', 'OK', {
          duration: 7000,
        });
      },
    });
  }

  protected cancelMerge(): void {
    const request = this.mergeRequest();
    if (!request) {
      return;
    }

    this.apiService.cancelAccountMerge(request.id).subscribe({
      next: () => {
        this.mergeRequest.set(null);
        this.clearQueryParams();
      },
    });
  }

  protected progressValue(score: number): number {
    return Math.min(Math.max(score, 0), 100);
  }

  protected isProcessing(request: AccountMergeRequest): boolean {
    return ['pending_score', 'pending_merge'].includes(request.status);
  }

  protected statusTitle(request: AccountMergeRequest): string {
    switch (request.status) {
      case 'pending':
        return 'Escolha o e-mail principal';
      case 'pending_score':
        return 'Calculando qual perfil deve permanecer ativo';
      case 'pending_merge':
        return 'Unificação em andamento';
      case 'completed':
        return 'Contas unificadas';
      case 'failed':
        return 'Não foi possível concluir a unificação';
      case 'expired':
        return 'Solicitação expirada';
      default:
        return 'Unificação de contas';
    }
  }

  protected statusMessage(request: AccountMergeRequest): string {
    switch (request.status) {
      case 'pending':
        return 'Antes de calcularmos a pontuação, selecione qual endereço deve ficar como principal.';
      case 'pending_score':
        return 'Estamos avaliando os dados locais e aguardando, quando disponível, a pontuação de sistemas externos. Isso pode levar até 30 minutos.';
      case 'pending_merge':
        return 'A conta principal já foi definida. Estamos notificando os outros sistemas e repetiremos automaticamente o que ainda não confirmou recebimento.';
      case 'completed':
        return 'Todos os sistemas necessários confirmaram a unificação.';
      case 'failed':
        return 'A solicitação parou por segurança. Tente novamente ou entre em contato com o suporte.';
      case 'expired':
        return 'Essa solicitação ficou aberta por muito tempo. Inicie o vínculo novamente.';
      default:
        return '';
    }
  }

  private loadMergeRequest(requestId: string): void {
    this.isLoading.set(true);
    this.apiService.getAccountMergeRequest(requestId).subscribe({
      next: (request) => {
        this.mergeRequest.set(request);
        this.selectedPrimaryEmail.set(
          request.selectedPrimaryEmail ||
            request.primaryEmailOptions[0] ||
            request.scores.find((score) => score.userId === request.primaryUserId)?.email ||
            '',
        );
        this.isLoading.set(false);
        if (this.isProcessing(request)) {
          this.startPolling(request.id);
        }
      },
      error: () => {
        this.isLoading.set(false);
        this.snackBar.open('Solicitação de unificação expirada ou inválida.', 'OK', {
          duration: 7000,
        });
        this.clearQueryParams();
      },
    });
  }

  private startPolling(requestId: string): void {
    this.activeMergeRequestId = requestId;
    this.stopPolling();
    this.pollTimer = window.setInterval(() => {
      if (!this.activeMergeRequestId) {
        return;
      }

      this.apiService.getAccountMergeRequest(this.activeMergeRequestId).subscribe({
        next: (request) => {
          this.mergeRequest.set(request);
          if (!this.isProcessing(request)) {
            this.stopPolling();
            if (request.status === 'completed') {
              this.authService.refresh();
              this.clearQueryParams();
            }
          }
        },
      });
    }, 10000);
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      window.clearInterval(this.pollTimer);
      this.pollTimer = undefined;
    }
  }

  private clearQueryParams(): void {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: {
        accountLink: null,
        merge_request: null,
      },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
