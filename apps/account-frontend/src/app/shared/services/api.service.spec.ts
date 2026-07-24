import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { CacheService } from './cache.service';
import { AccountLinkingApiService } from './api/account-linking-api.service';
import { AuthApiService } from './api/auth-api.service';
import { DiscordApiService } from './api/discord-api.service';
import { KeycloakPermissionsApiService } from './api/keycloak-permissions-api.service';
import { LgpdApiService } from './api/lgpd-api.service';
import { PrivacyApiService } from './api/privacy-api.service';
import { TotpApiService } from './api/totp-api.service';
import { ApiService } from './api.service';

describe('ApiService account merge facade', () => {
  const accountLinkingApi = {
    watchAccountMergeRequest: vi.fn().mockReturnValue(of({ id: 'user-request' })),
    createAdminAccountMerge: vi.fn().mockReturnValue(of({ id: 'admin-request' })),
    getAdminAccountMergeRequest: vi.fn().mockReturnValue(of({ id: 'admin-request' })),
    watchAdminAccountMergeRequest: vi.fn().mockReturnValue(of({ id: 'admin-request' })),
    confirmAdminAccountMerge: vi.fn().mockReturnValue(of({ request: { id: 'admin-request' } })),
    cancelAdminAccountMerge: vi.fn().mockReturnValue(of({ success: true })),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        ApiService,
        { provide: CacheService, useValue: {} },
        { provide: AccountLinkingApiService, useValue: accountLinkingApi },
        { provide: AuthApiService, useValue: {} },
        { provide: DiscordApiService, useValue: {} },
        { provide: KeycloakPermissionsApiService, useValue: {} },
        { provide: LgpdApiService, useValue: {} },
        { provide: PrivacyApiService, useValue: {} },
        { provide: TotpApiService, useValue: {} },
      ],
    });
  });

  it('forwards user and administrator merge operations without altering their payloads', () => {
    const service = TestBed.inject(ApiService);
    const dto = { requesterUserId: 'first-user', candidateUserId: 'second-user' };
    const confirmation = { primaryEmail: 'first@example.com' };

    service.watchAccountMergeRequest('user-request').subscribe();
    service.createAdminAccountMerge(dto).subscribe();
    service.getAdminAccountMergeRequest('admin-request').subscribe();
    service.watchAdminAccountMergeRequest('admin-request').subscribe();
    service.confirmAdminAccountMerge('admin-request', confirmation).subscribe();
    service.cancelAdminAccountMerge('admin-request').subscribe();

    expect(accountLinkingApi.watchAccountMergeRequest).toHaveBeenCalledWith('user-request');
    expect(accountLinkingApi.createAdminAccountMerge).toHaveBeenCalledWith(dto);
    expect(accountLinkingApi.getAdminAccountMergeRequest).toHaveBeenCalledWith('admin-request');
    expect(accountLinkingApi.watchAdminAccountMergeRequest).toHaveBeenCalledWith('admin-request');
    expect(accountLinkingApi.confirmAdminAccountMerge).toHaveBeenCalledWith('admin-request', confirmation);
    expect(accountLinkingApi.cancelAdminAccountMerge).toHaveBeenCalledWith('admin-request');
  });
});
