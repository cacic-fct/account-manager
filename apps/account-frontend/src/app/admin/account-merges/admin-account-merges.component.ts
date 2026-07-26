import { isPlatformBrowser } from '@angular/common';
import { ChangeDetectionStrategy, Component, OnDestroy, PLATFORM_ID, WritableSignal, computed, inject, signal } from '@angular/core';
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
  protected readonly mergeRequest = signal<AccountMergeRequest | null>(null);
  protected readonly selectedPrimaryEmail = signal('');
  protected readonly mergeUpdatesFailed = signal(false);
  protected readonly isProcessing = computed(() => {
    const status = this.mergeRequest()?.status;
    return status === 'pending_score' || status === 'pending_merge';
  });
  protected readonly canCreate = computed(() => {
    const firstUser = this.firstUser();
    const secondUser = this.secondUser();
    return !!firstUser && !!secondUser && firstUser.id !== secondUser.id;
  });

  private mergeUpdatesSubscription?: Subscription;

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
    if (!requester || !candidate || requester.id === candidate.id) {
      return;
    }

    this.creating.set(true);
    this.apiService.createAdminAccountMerge({ requesterUserId: requester.id, candidateUserId: candidate.id }).subscribe({
      next: (request) => {
        this.mergeRequest.set(request);
        this.selectedPrimaryEmail.set(request.primaryEmailOptions[0] || '');
        this.creating.set(false);
      },
      error: () => {
        this.creating.set(false);
        this.snackBar.open('Não foi possível iniciar a unificação das contas.', 'Fechar', { duration: 6000 });
      },
    });
  }

  protected confirmMerge(): void {
    const request = this.mergeRequest();
    const primaryEmail = this.selectedPrimaryEmail();
    if (!request || !primaryEmail) {
      return;
    }

    this.confirming.set(true);
    this.apiService.confirmAdminAccountMerge(request.id, { primaryEmail }).subscribe({
      next: (response) => {
        this.mergeRequest.set(response.request);
        this.confirming.set(false);
        this.startMergeUpdates(response.request.id);
        this.snackBar.open('Unificação iniciada. O progresso será atualizado nesta página.', 'Fechar', { duration: 6000 });
      },
      error: () => {
        this.confirming.set(false);
        this.snackBar.open('Não foi possível confirmar a unificação.', 'Fechar', { duration: 6000 });
      },
    });
  }

  protected cancelMerge(): void {
    const request = this.mergeRequest();
    if (!request) {
      return;
    }

    this.apiService.cancelAdminAccountMerge(request.id).subscribe({
      next: () => {
        this.stopMergeUpdates();
        this.mergeRequest.set(null);
        this.selectedPrimaryEmail.set('');
      },
      error: () => {
        this.snackBar.open('Não foi possível cancelar a unificação.', 'Fechar', { duration: 6000 });
      },
    });
  }

  protected reset(): void {
    this.stopMergeUpdates();
    this.mergeRequest.set(null);
    this.selectedPrimaryEmail.set('');
    this.firstUser.set(null);
    this.secondUser.set(null);
    this.mergeUpdatesFailed.set(false);
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
    this.apiService.searchKeycloakPermissionUsers(query).subscribe({
      next: (results) => {
        users.set(results.filter((user) => user.enabled !== false));
        searching.set(false);
      },
      error: () => {
        searching.set(false);
        this.snackBar.open('Erro ao buscar contas no Keycloak.', 'Fechar', { duration: 5000 });
      },
    });
  }

  private startMergeUpdates(requestId: string): void {
    this.stopMergeUpdates();
    this.mergeUpdatesFailed.set(false);
    if (!this.isBrowser) {
      return;
    }

    this.mergeUpdatesSubscription = this.apiService.watchAdminAccountMergeRequest(requestId).subscribe({
      next: (delta) => {
        const request = { ...this.mergeRequest(), ...delta } as AccountMergeRequest;
        this.mergeRequest.set(request);
        if (!['pending_score', 'pending_merge'].includes(request.status)) {
          this.stopMergeUpdates();
        }
      },
      error: () => {
        this.mergeUpdatesFailed.set(true);
        this.snackBar.open('Não foi possível acompanhar a unificação em tempo real.', 'Fechar', { duration: 7000 });
      },
    });
  }

  protected retryMergeUpdates(): void {
    const requestId = this.mergeRequest()?.id;
    if (requestId) this.startMergeUpdates(requestId);
  }

  private stopMergeUpdates(): void {
    this.mergeUpdatesSubscription?.unsubscribe();
    this.mergeUpdatesSubscription = undefined;
  }
}
