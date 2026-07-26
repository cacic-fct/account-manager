import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import { AccountMergeRequest } from '@cacic/shared-types';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';
import { MatSnackBar } from '@angular/material/snack-bar';
import { signal } from '@angular/core';
import { ApiService } from '../../../shared/services/api.service';
import { AuthService } from '../../../shared/services/auth/auth.service';
import { GoogleAccountLinkingComponent } from './google-account-linking.component';

const mergeRequest: AccountMergeRequest = {
  id: 'merge-request-1',
  status: 'pending_merge',
  requesterUserId: 'secondary-user',
  candidateUserId: 'primary-user',
  primaryUserId: 'primary-user',
  secondaryUserId: 'secondary-user',
  primaryEmailOptions: ['primary@example.com', 'secondary@example.com'],
  selectedPrimaryEmail: 'primary@example.com',
  secondaryEmails: ['secondary@example.com'],
  notificationSummary: { pending: 1, completed: 0, failed: 0 },
  scores: [
    { userId: 'primary-user', email: 'primary@example.com', displayName: 'Primary', score: 120, contributions: [] },
    { userId: 'secondary-user', email: 'secondary@example.com', displayName: 'Secondary', score: -5, contributions: [] },
  ],
  externalScores: [],
  expiresAt: '2026-07-24T12:00:00.000Z',
  createdAt: '2026-07-24T11:45:00.000Z',
};

type Harness = GoogleAccountLinkingComponent & {
  mergeRequest: { (): AccountMergeRequest | null; set: (request: AccountMergeRequest | null) => void };
  selectedPrimaryEmail: { (): string; set: (email: string) => void };
  isLoading: { (): boolean };
  isConfirming: { (): boolean };
  primaryScore: { (): AccountMergeRequest['scores'][number] | undefined };
  secondaryScore: { (): AccountMergeRequest['scores'][number] | undefined };
  startLinking: () => void;
  confirmMerge: () => void;
  cancelMerge: () => void;
  progressValue: (score: number) => number;
  statusTitle: (request: AccountMergeRequest) => string;
  statusMessage: (request: AccountMergeRequest) => string;
};

type ApiServiceMock = {
  startGoogleAccountLinking: ReturnType<typeof vi.fn>;
  getAccountMergeRequest: ReturnType<typeof vi.fn>;
  watchAccountMergeRequest: ReturnType<typeof vi.fn>;
  confirmAccountMerge: ReturnType<typeof vi.fn>;
  cancelAccountMerge: ReturnType<typeof vi.fn>;
};

describe('GoogleAccountLinkingComponent', () => {
  let fixture: ComponentFixture<GoogleAccountLinkingComponent>;
  let queryParams: BehaviorSubject<ReturnType<typeof convertToParamMap>>;
  let updates: Subject<Partial<AccountMergeRequest> & Pick<AccountMergeRequest, 'id'>>;
  let apiService: ApiServiceMock;
  let authService: { currentUser: ReturnType<typeof signal>; refresh: ReturnType<typeof vi.fn> };
  let router: { navigate: ReturnType<typeof vi.fn> };
  let snackBar: { open: ReturnType<typeof vi.fn> };
  let snackBarAction: Subject<void>;

  beforeEach(async () => {
    queryParams = new BehaviorSubject(convertToParamMap({}));
    updates = new Subject();
    apiService = {
      startGoogleAccountLinking: vi.fn().mockReturnValue(of({ url: 'https://sso.example/login' })),
      getAccountMergeRequest: vi.fn().mockReturnValue(of(mergeRequest)),
      watchAccountMergeRequest: vi.fn().mockReturnValue(updates),
      confirmAccountMerge: vi.fn().mockReturnValue(of({ request: mergeRequest })),
      cancelAccountMerge: vi.fn().mockReturnValue(of({ success: true })),
    };
    authService = { currentUser: signal(null), refresh: vi.fn() };
    router = { navigate: vi.fn() };
    snackBarAction = new Subject<void>();
    snackBar = { open: vi.fn().mockReturnValue({ onAction: () => snackBarAction }) };

    await TestBed.configureTestingModule({
      imports: [GoogleAccountLinkingComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: authService },
        { provide: ActivatedRoute, useValue: { queryParamMap: queryParams } },
        { provide: Router, useValue: router },
        { provide: MatSnackBar, useValue: snackBar },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(GoogleAccountLinkingComponent);
  });

  it('loads a processing merge from the query string and applies SSE completion updates', () => {
    fixture.detectChanges();
    queryParams.next(convertToParamMap({ merge_request: mergeRequest.id }));

    expect(apiService.getAccountMergeRequest).toHaveBeenCalledWith(mergeRequest.id);
    expect(apiService.watchAccountMergeRequest).toHaveBeenCalledWith(mergeRequest.id);

    updates.next({ id: mergeRequest.id, status: 'completed' });

    const component = fixture.componentInstance as unknown as Harness;
    expect(component.mergeRequest()?.status).toBe('completed');
    expect(authService.refresh).toHaveBeenCalled();
    expect(router.navigate).toHaveBeenCalled();
    expect(updates.observed).toBe(false);
  });

  it('reports query, request, and stream failures while preserving recoverable UI state', () => {
    apiService.getAccountMergeRequest.mockReturnValue(throwError(() => new Error('missing')));
    fixture.detectChanges();
    queryParams.next(convertToParamMap({ accountLink: 'failed', merge_request: mergeRequest.id }));

    const component = fixture.componentInstance as unknown as Harness;
    expect(component.isLoading()).toBe(false);
    expect(snackBar.open).toHaveBeenCalledWith('Não foi possível vincular a conta Google.', 'OK', { duration: 7000 });
    expect(snackBar.open).toHaveBeenCalledWith('Solicitação de unificação expirada ou inválida.', 'OK', { duration: 7000 });

    component.mergeRequest.set(mergeRequest);
    component.selectedPrimaryEmail.set(mergeRequest.primaryEmailOptions[0]);
    apiService.watchAccountMergeRequest.mockReturnValue(throwError(() => new Error('stream unavailable')));
    component.confirmMerge();

    expect(snackBar.open).toHaveBeenCalledWith(
      'Não foi possível acompanhar a unificação em tempo real.',
      'OK',
      { duration: 7000 },
    );
    expect(snackBar.open).toHaveBeenCalledWith(
      'Não foi possível recuperar o status da unificação.',
      'Tentar novamente',
      { duration: 7000 },
    );

    snackBarAction.next();

    expect(apiService.watchAccountMergeRequest).toHaveBeenCalledTimes(2);
  });

  it('confirms and cancels a merge, including its derived display state', () => {
    fixture.detectChanges();
    const component = fixture.componentInstance as unknown as Harness;
    component.mergeRequest.set(mergeRequest);
    component.selectedPrimaryEmail.set(mergeRequest.primaryEmailOptions[0]);

    component.confirmMerge();

    expect(apiService.confirmAccountMerge).toHaveBeenCalledWith(mergeRequest.id, { primaryEmail: 'primary@example.com' });
    expect(component.isConfirming()).toBe(false);
    expect(component.primaryScore()?.email).toBe('primary@example.com');
    expect(component.secondaryScore()?.email).toBe('secondary@example.com');
    expect(component.progressValue(120)).toBe(100);
    expect(component.progressValue(-5)).toBe(0);
    expect(component.statusTitle({ ...mergeRequest, status: 'expired' })).toBe('Solicitação expirada');
    expect(component.statusMessage({ ...mergeRequest, status: 'failed' })).toContain('segurança');

    component.cancelMerge();

    expect(apiService.cancelAccountMerge).toHaveBeenCalledWith(mergeRequest.id);
    expect(component.mergeRequest()).toBeNull();
  });
});
