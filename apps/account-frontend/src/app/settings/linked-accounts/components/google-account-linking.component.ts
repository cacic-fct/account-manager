import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  OnInit,
  PLATFORM_ID,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { AccountMergeRequest } from '@cacic/shared-types';
import { Subscription } from 'rxjs';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { getApiErrorMessage } from '../../../shared/utils/api-error-message';

@Component({
  selector: 'app-google-account-linking',
  imports: [
    MatButtonModule,
    MatDividerModule,
    MatFormFieldModule,
    MatIconModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
  ],
  templateUrl: './google-account-linking.component.html',
  styleUrl: './google-account-linking.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GoogleAccountLinkingComponent implements OnInit, OnDestroy {
  private readonly apiService = inject(ApiService);
  private readonly authService = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly currentUser = this.authService.currentUser;
  protected readonly isLoading = signal(false);
  protected readonly isConfirming = signal(false);
  protected readonly mergeRequest = signal<AccountMergeRequest | null>(null);
  protected readonly selectedPrimaryEmail = signal('');
  private mergeUpdatesSubscription?: Subscription;
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
    this.stopMergeUpdates();
  }

  protected startLinking(): void {
    this.isLoading.set(true);
    this.apiService.startGoogleAccountLinking().subscribe({
      next: ({ url }) => {
        window.location.href = url;
      },
      error: (error) => {
        this.isLoading.set(false);
        this.snackBar.open(
          getApiErrorMessage(error, 'Não foi possível iniciar o vínculo com o Google. Tente novamente.'),
          'Fechar',
          {
            duration: 7000,
          },
        );
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
        this.startMergeUpdates(response.request.id);
        this.snackBar.open('Unificação iniciada. Vamos acompanhar por aqui.', 'OK', {
          duration: 6000,
        });
      },
      error: (error) => {
        this.isConfirming.set(false);
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível confirmar a unificação. Atualize a página para ver se o processo começou antes de tentar novamente.',
          ),
          'Fechar',
          {
            duration: 7000,
          },
        );
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
        this.stopMergeUpdates();
        this.mergeRequest.set(null);
        this.clearQueryParams();
      },
      error: (error) => {
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível cancelar a unificação. Atualize a página para ver se ela ainda está em andamento.',
          ),
          'Fechar',
          { duration: 7000 },
        );
      },
    });
  }

  protected progressValue(score: number): number {
    return Math.min(Math.max(score, 0), 100);
  }

  protected isProcessing(request: AccountMergeRequest): boolean {
    return ['pending_score', 'processing', 'pending_merge'].includes(request.status);
  }

  protected statusTitle(request: AccountMergeRequest): string {
    switch (request.status) {
      case 'pending':
        return 'Escolha o e-mail principal';
      case 'pending_score':
        return 'Calculando qual perfil deve permanecer ativo';
      case 'processing':
        return 'Unificação em andamento';
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
        return 'Escolha o endereço que você quer usar como e-mail principal da conta CACiC.';
      case 'pending_score':
        return 'Estamos verificando os dados dos dois perfis. Isso pode levar até 30 minutos.';
      case 'processing':
        return 'Estamos unificando os dados das contas. Não feche esta página enquanto o processo estiver em andamento.';
      case 'pending_merge':
        return 'Seu perfil principal já foi definido. Estamos concluindo a atualização nos sistemas integrados.';
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
          this.startMergeUpdates(request.id);
        }
      },
      error: (error) => {
        this.isLoading.set(false);
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível abrir esta solicitação de unificação. Ela pode ter expirado; tente vincular a conta novamente.',
          ),
          'Fechar',
          {
            duration: 7000,
          },
        );
        this.clearQueryParams();
      },
    });
  }

  private startMergeUpdates(requestId: string): void {
    this.stopMergeUpdates();
    if (!this.isBrowser) {
      return;
    }

    this.mergeUpdatesSubscription = this.apiService.watchAccountMergeRequest(requestId).subscribe({
      next: (delta) => {
        const request = { ...this.mergeRequest(), ...delta } as AccountMergeRequest;
        this.mergeRequest.set(request);
        if (!this.isProcessing(request)) {
          this.stopMergeUpdates();
          if (request.status === 'completed') {
            this.authService.refresh();
            this.clearQueryParams();
          }
        }
      },
      error: (error) => {
        this.snackBar.open(
          getApiErrorMessage(error, 'A atualização em tempo real parou. Vamos consultar o andamento da unificação…'),
          'Fechar',
          { duration: 7000 },
        );
        this.apiService.getAccountMergeRequest(requestId).subscribe({
          next: (request) => {
            this.mergeRequest.set(request);
            if (this.isProcessing(request)) {
              this.startMergeUpdates(request.id);
            } else if (request.status === 'completed') {
              this.authService.refresh();
              this.clearQueryParams();
            }
          },
          error: (error) => {
            this.snackBar
              .open(
                getApiErrorMessage(error, 'Não foi possível consultar o status da unificação. Tente novamente.'),
                'Tentar novamente',
                { duration: 7000 },
              )
              .onAction()
              .subscribe(() => this.startMergeUpdates(requestId));
          },
        });
      },
    });
  }

  private stopMergeUpdates(): void {
    this.mergeUpdatesSubscription?.unsubscribe();
    this.mergeUpdatesSubscription = undefined;
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
