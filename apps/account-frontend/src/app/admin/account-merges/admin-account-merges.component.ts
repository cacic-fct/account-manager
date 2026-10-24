import { isPlatformBrowser } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  PLATFORM_ID,
  WritableSignal,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AccountMergeRequest, KeycloakPermissionUser } from '@cacic/shared-types';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatToolbarModule } from '@angular/material/toolbar';
import { Subscription } from 'rxjs';
import { ApiService } from '../../shared/services/api.service';
import { getApiErrorMessage } from '../../shared/utils/api-error-message';
import { KeycloakPermissionsPersonPickerComponent } from '../keycloak-permissions/keycloak-permissions-person-picker.component';

@Component({
  selector: 'app-admin-account-merges',
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatChipsModule,
    MatFormFieldModule,
    MatIconModule,
    MatListModule,
    MatProgressBarModule,
    MatProgressSpinnerModule,
    MatSelectModule,
    MatToolbarModule,
    KeycloakPermissionsPersonPickerComponent,
  ],
  templateUrl: './admin-account-merges.component.html',
  styleUrl: './admin-account-merges.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminAccountMergesComponent implements OnDestroy {
  private readonly apiService = inject(ApiService);
  private readonly formBuilder = inject(FormBuilder);
  private readonly snackBar = inject(MatSnackBar);
  private readonly isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  protected readonly firstSearchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });
  protected readonly secondSearchForm = this.formBuilder.nonNullable.group({
    query: ['', [Validators.required, Validators.minLength(2)]],
  });
  protected readonly firstUsers = signal<KeycloakPermissionUser[]>([]);
  protected readonly secondUsers = signal<KeycloakPermissionUser[]>([]);
  protected readonly firstUser = signal<KeycloakPermissionUser | null>(null);
  protected readonly secondUser = signal<KeycloakPermissionUser | null>(null);
  protected readonly firstSearching = signal(false);
  protected readonly secondSearching = signal(false);
  protected readonly creating = signal(false);
  protected readonly confirming = signal(false);
  protected readonly canceling = signal(false);
  protected readonly mergeRequest = signal<AccountMergeRequest | null>(null);
  protected readonly selectedPrimaryEmail = signal('');
  protected readonly mergeUpdatesFailed = signal(false);
  protected readonly mergeUpdatesError = signal<string | null>(null);
  protected readonly requestStateStale = signal(false);
  protected readonly requestStateError = signal<string | null>(null);
  protected readonly refreshingRequestState = signal(false);
  protected readonly isProcessing = computed(() => {
    const status = this.mergeRequest()?.status;
    return status === 'pending_score' || status === 'processing' || status === 'pending_merge';
  });
  protected readonly canCreate = computed(() => {
    const firstUser = this.firstUser();
    const secondUser = this.secondUser();
    return !!firstUser && !!secondUser && firstUser.id !== secondUser.id;
  });

  private mergeUpdatesSubscription?: Subscription;
  private mergeRequestRefreshId = 0;

  ngOnDestroy(): void {
    this.stopMergeUpdates();
  }

  protected searchFirstUser(): void {
    this.searchUsers(this.firstSearchForm, this.firstSearching, this.firstUsers);
  }

  protected searchSecondUser(): void {
    this.searchUsers(this.secondSearchForm, this.secondSearching, this.secondUsers);
  }

  protected createMergeRequest(): void {
    const requester = this.firstUser();
    const candidate = this.secondUser();
    if (
      !requester ||
      !candidate ||
      requester.id === candidate.id ||
      this.mergeRequest() !== null ||
      this.creating() ||
      this.requestStateStale() ||
      this.refreshingRequestState()
    ) {
      return;
    }

    this.creating.set(true);
    this.apiService
      .createAdminAccountMerge({ requesterUserId: requester.id, candidateUserId: candidate.id })
      .subscribe({
        next: (request) => {
          this.mergeRequest.set(request);
          this.selectedPrimaryEmail.set(request.primaryEmailOptions[0] || '');
          this.creating.set(false);
        },
        error: (error: unknown) => {
          this.creating.set(false);
          this.snackBar.open(
            getApiErrorMessage(
              error,
              'Não foi possível verificar se a solicitação foi criada. Confira a situação das contas antes de tentar novamente.',
            ),
            'Fechar',
            { duration: 8000 },
          );
        },
      });
  }

  protected confirmMerge(): void {
    const request = this.mergeRequest();
    const primaryEmail = this.selectedPrimaryEmail();
    if (
      !request ||
      request.status !== 'pending' ||
      !primaryEmail ||
      this.confirming() ||
      this.canceling() ||
      this.requestStateStale() ||
      this.refreshingRequestState()
    ) {
      return;
    }

    this.confirming.set(true);
    this.apiService.confirmAdminAccountMerge(request.id, { primaryEmail }).subscribe({
      next: (response) => {
        this.mergeRequest.set(response.request);
        this.confirming.set(false);
        this.startMergeUpdates(response.request.id);
        this.snackBar.open('Unificação iniciada. O progresso será atualizado nesta página.', 'Fechar', {
          duration: 6000,
        });
      },
      error: (error: unknown) => {
        this.confirming.set(false);
        this.requestStateStale.set(true);
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível verificar se a unificação foi iniciada. Aguarde a atualização do status antes de tentar novamente.',
          ),
          'Fechar',
          { duration: 8000 },
        );
        this.refreshMergeRequest(request.id);
      },
    });
  }

  protected cancelMerge(): void {
    const request = this.mergeRequest();
    if (
      !request ||
      request.status !== 'pending' ||
      this.canceling() ||
      this.confirming() ||
      this.requestStateStale() ||
      this.refreshingRequestState()
    ) {
      return;
    }

    this.canceling.set(true);
    this.apiService.cancelAdminAccountMerge(request.id).subscribe({
      next: () => {
        this.stopMergeUpdates();
        this.canceling.set(false);
        this.mergeRequest.set(null);
        this.selectedPrimaryEmail.set('');
      },
      error: (error: unknown) => {
        this.canceling.set(false);
        this.requestStateStale.set(true);
        this.snackBar.open(
          getApiErrorMessage(
            error,
            'Não foi possível verificar se a solicitação foi cancelada. Aguarde a atualização do status antes de tentar novamente.',
          ),
          'Fechar',
          { duration: 8000 },
        );
        this.refreshMergeRequest(request.id);
      },
    });
  }

  protected refreshMergeRequest(requestId: string): void {
    if (this.mergeRequest()?.id !== requestId || this.refreshingRequestState()) {
      return;
    }

    const refreshId = ++this.mergeRequestRefreshId;
    this.stopMergeUpdates();
    this.refreshingRequestState.set(true);
    this.requestStateStale.set(true);
    this.requestStateError.set(null);
    this.apiService.getAdminAccountMergeRequest(requestId).subscribe({
      next: (request) => {
        if (refreshId !== this.mergeRequestRefreshId || this.mergeRequest()?.id !== requestId) {
          return;
        }

        this.mergeRequest.set(request);
        this.selectedPrimaryEmail.set(request.selectedPrimaryEmail ?? this.selectedPrimaryEmail());
        this.requestStateStale.set(false);
        this.requestStateError.set(null);
        this.refreshingRequestState.set(false);
        if (['pending_score', 'processing', 'pending_merge'].includes(request.status)) {
          this.startMergeUpdates(request.id);
        } else {
          this.stopMergeUpdates();
        }
      },
      error: (error: unknown) => {
        if (refreshId !== this.mergeRequestRefreshId || this.mergeRequest()?.id !== requestId) {
          return;
        }

        this.requestStateError.set(
          getApiErrorMessage(
            error,
            'Não foi possível atualizar o status da solicitação. Tente atualizar novamente antes de continuar.',
          ),
        );
        this.refreshingRequestState.set(false);
      },
    });
  }

  protected reset(): void {
    if (this.confirming() || this.canceling() || this.requestStateStale() || this.refreshingRequestState()) {
      return;
    }

    this.mergeRequestRefreshId++;
    this.stopMergeUpdates();
    this.mergeRequest.set(null);
    this.selectedPrimaryEmail.set('');
    this.firstUser.set(null);
    this.secondUser.set(null);
    this.mergeUpdatesFailed.set(false);
    this.mergeUpdatesError.set(null);
    this.requestStateStale.set(false);
    this.requestStateError.set(null);
    this.refreshingRequestState.set(false);
  }

  protected progressValue(score: number): number {
    return Math.min(Math.max(score, 0), 100);
  }

  private searchUsers(
    form: typeof this.firstSearchForm,
    searching: WritableSignal<boolean>,
    users: WritableSignal<KeycloakPermissionUser[]>,
  ): void {
    const query = form.controls.query.value.trim();
    if (form.invalid || query.length < 2) {
      form.markAllAsTouched();
      return;
    }

    searching.set(true);
    users.set([]);
    this.apiService.searchKeycloakPermissionUsers(query).subscribe({
      next: (results) => {
        users.set(results.filter((user) => user.enabled !== false));
        searching.set(false);
      },
      error: (error: unknown) => {
        searching.set(false);
        this.snackBar.open(
          getApiErrorMessage(error, 'Não foi possível buscar contas no Keycloak. Tente novamente em instantes.'),
          'Fechar',
          { duration: 6000 },
        );
      },
    });
  }

  private startMergeUpdates(requestId: string): void {
    this.stopMergeUpdates();
    this.mergeUpdatesFailed.set(false);
    this.mergeUpdatesError.set(null);
    if (!this.isBrowser) {
      return;
    }

    this.mergeUpdatesSubscription = this.apiService.watchAdminAccountMergeRequest(requestId).subscribe({
      next: (delta) => {
        if (this.mergeRequest()?.id !== requestId || this.requestStateStale()) {
          return;
        }

        const request = { ...this.mergeRequest(), ...delta } as AccountMergeRequest;
        this.mergeRequest.set(request);
        if (!['pending_score', 'processing', 'pending_merge'].includes(request.status)) {
          this.stopMergeUpdates();
        }
      },
      error: (error: unknown) => {
        if (this.mergeRequest()?.id !== requestId || this.requestStateStale()) {
          return;
        }

        this.mergeUpdatesFailed.set(true);
        const message = getApiErrorMessage(
          error,
          'Não foi possível acompanhar o andamento da unificação em tempo real. Atualize o status antes de decidir o próximo passo.',
        );
        this.mergeUpdatesError.set(message);
        this.snackBar.open(message, 'Fechar', { duration: 8000 });
      },
    });
  }

  protected retryMergeUpdates(): void {
    const requestId = this.mergeRequest()?.id;
    if (requestId && !this.requestStateStale() && !this.refreshingRequestState()) {
      this.startMergeUpdates(requestId);
    }
  }

  private stopMergeUpdates(): void {
    this.mergeUpdatesSubscription?.unsubscribe();
    this.mergeUpdatesSubscription = undefined;
  }
}
