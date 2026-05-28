import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  User,
  CreateUserProfile,
  AuthStatus,
  Application,
  LgpdRequest,
  LgpdRequestDetail,
  DeleteAccountRequest,
  DeleteAccountResponse,
  AdminDeleteAccountRequest,
  DiscordLink,
  DiscordLinkStatus,
  DiscordAuthUrl,
  ServerSetting,
  UpdateServerSetting,
  DiscordRole,
  SelectableRoles,
  UpdateRoleSelection,
  UserRoleSelection,
  PrivacySettings,
  PrivacySetting,
  UpdatePrivacySetting,
  BulkUpdatePrivacySettings,
  CookieBannerStatus,
  UserRoles,
  RoleSelectionResponse,
  AccountMergeRequest,
  AccountLinkingStartUrl,
  ConfirmAccountMergeRequest,
  ConfirmAccountMergeResponse,
} from '@cacic/shared-types';
import { CacheService } from './cache.service';
import { getApiBaseUrl } from '../utils/api-url.util';

export type {
  LgpdRequest,
  LgpdRequestDetail,
  DeleteAccountRequest,
  DeleteAccountResponse,
  AdminDeleteAccountRequest,
  DiscordLink,
  DiscordLinkStatus,
  DiscordAuthUrl,
  ServerSetting,
  UpdateServerSetting,
  DiscordRole,
  SelectableRoles,
  UpdateRoleSelection,
  UserRoleSelection,
  PrivacySettings,
  PrivacySetting,
  UpdatePrivacySetting,
  BulkUpdatePrivacySettings,
  CookieBannerStatus,
  UserRoles,
  RoleSelectionResponse,
  AccountMergeRequest,
  AccountLinkingStartUrl,
  ConfirmAccountMergeRequest,
  ConfirmAccountMergeResponse,
} from '@cacic/shared-types';

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);

  // Cache keys
  private readonly CACHE_KEYS = {
    CURRENT_USER: 'api.currentUser',
    AUTH_STATUS: 'api.authStatus',
    APPLICATIONS: 'api.applications',
    UNESP_ROLE_REQUIRED: 'api.unespRoleRequired',
    LGPD_REQUESTS: 'api.lgpdRequests',
    ONBOARDING_STATUS: 'api.onboardingStatus',
    DISCORD_STATUS: 'api.discordStatus',
    SERVER_SETTINGS: 'api.serverSettings',
    ACCOUNT_MERGE_REQUEST: 'api.accountMergeRequest',
  } as const;

  // Cache durations (in milliseconds)
  private readonly CACHE_DURATIONS = {
    CURRENT_USER: 10 * 60 * 1000, // 10 minutes
    AUTH_STATUS: 5 * 60 * 1000, // 5 minutes
    APPLICATIONS: 30 * 60 * 1000, // 30 minutes
    UNESP_ROLE_REQUIRED: 60 * 60 * 1000, // 1 hour
    LGPD_REQUESTS: 2 * 60 * 1000, // 2 minutes (shorter due to status changes)
    ONBOARDING_STATUS: 10 * 60 * 1000, // 10 minutes
    DISCORD_STATUS: 5 * 60 * 1000, // 5 minutes
    SERVER_SETTINGS: 15 * 60 * 1000, // 15 minutes
    ACCOUNT_MERGE_REQUEST: 30 * 1000,
  } as const;

  getCurrentUser(): Observable<User> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.CURRENT_USER,
      () =>
        this.http.get<User>(`${this.baseUrl}/auth/me`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.CURRENT_USER,
      2 * 60 * 1000, // Background refresh after 2 minutes
    );
  }

  updateProfile(profile: CreateUserProfile): Observable<User> {
    return this.http
      .post<User>(`${this.baseUrl}/auth/profile`, profile, {
        withCredentials: true,
      })
      .pipe(
        tap((user) => {
          // Update cache with new user data
          this.cacheService.set(this.CACHE_KEYS.CURRENT_USER, user);
        }),
      );
  }

  checkAuth(): Observable<AuthStatus> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.AUTH_STATUS,
      () =>
        this.http.get<AuthStatus>(`${this.baseUrl}/auth/check`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.AUTH_STATUS,
      1 * 60 * 1000, // Background refresh after 1 minute
    );
  }

  getOnboardingStatus(): Observable<{
    needsOnboarding: boolean;
    missingFields: string[];
  }> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.ONBOARDING_STATUS,
      () =>
        this.http.get<{
          needsOnboarding: boolean;
          missingFields: string[];
        }>(`${this.baseUrl}/auth/onboarding-status`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.ONBOARDING_STATUS,
    );
  }

  checkUnespRoleRequired(): Observable<{
    shouldShowUnespRoleSelection: boolean;
  }> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.UNESP_ROLE_REQUIRED,
      () =>
        this.http.get<{ shouldShowUnespRoleSelection: boolean }>(
          `${this.baseUrl}/auth/unesp-role-required`,
          {
            withCredentials: true,
          },
        ),
      this.CACHE_DURATIONS.UNESP_ROLE_REQUIRED,
    );
  }

  logout(): Observable<{ success: boolean }> {
    return this.http
      .post<{ success: boolean }>(
        `${this.baseUrl}/auth/logout`,
        {},
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          // Clear all auth-related cache on logout
          this.clearAuthCache();
        }),
      );
  }

  getLoginUrl(returnUrl?: string): string {
    if (!returnUrl) {
      return `${this.baseUrl}/auth/login`;
    }

    const query = new URLSearchParams({ ru: returnUrl });
    return `${this.baseUrl}/auth/login?${query.toString()}`;
  }

  getSilentLoginUrl(returnUrl?: string): string {
    if (!returnUrl) {
      return `${this.baseUrl}/auth/silent-login`;
    }

    const query = new URLSearchParams({ ru: returnUrl });
    return `${this.baseUrl}/auth/silent-login?${query.toString()}`;
  }

  consumePostOnboardingRedirect(): Observable<{ redirectUrl: string | null }> {
    return this.http.post<{ redirectUrl: string | null }>(
      `${this.baseUrl}/auth/post-onboarding-redirect`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  startGoogleAccountLinking(): Observable<AccountLinkingStartUrl> {
    return this.http.post<AccountLinkingStartUrl>(
      `${this.baseUrl}/auth/account-linking/google/start`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getAccountMergeRequest(id: string): Observable<AccountMergeRequest> {
    return this.http.get<AccountMergeRequest>(
      `${this.baseUrl}/auth/account-linking/merge-requests/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  confirmAccountMerge(
    id: string,
    dto: ConfirmAccountMergeRequest,
  ): Observable<ConfirmAccountMergeResponse> {
    return this.http
      .post<ConfirmAccountMergeResponse>(
        `${this.baseUrl}/auth/account-linking/merge-requests/${id}/confirm`,
        dto,
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          this.clearAuthCache();
          this.cacheService.invalidate(this.CACHE_KEYS.DISCORD_STATUS);
        }),
      );
  }

  cancelAccountMerge(id: string): Observable<{ success: true }> {
    return this.http.post<{ success: true }>(
      `${this.baseUrl}/auth/account-linking/merge-requests/${id}/cancel`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  // Admin status endpoint
  getAdminStatus(): Observable<{ isAdmin: boolean; adminGroups: string[] }> {
    return this.http.get<{ isAdmin: boolean; adminGroups: string[] }>(
      `${this.baseUrl}/auth/admin-status`,
      {
        withCredentials: true,
      },
    );
  }

  // LGPD endpoints
  createLgpdRequest(): Observable<LgpdRequestDetail> {
    return this.http
      .post<LgpdRequestDetail>(
        `${this.baseUrl}/lgpd/request`,
        {},
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          // Invalidate LGPD requests cache when creating new request
          this.cacheService.invalidate(this.CACHE_KEYS.LGPD_REQUESTS);
        }),
      );
  }

  getLgpdRequests(): Observable<LgpdRequest[]> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.LGPD_REQUESTS,
      () =>
        this.http.get<LgpdRequest[]>(`${this.baseUrl}/lgpd/requests`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.LGPD_REQUESTS,
    );
  }

  getLgpdRequest(id: string): Observable<LgpdRequestDetail> {
    // Individual requests don't need caching as they're not frequently accessed
    return this.http.get<LgpdRequestDetail>(
      `${this.baseUrl}/lgpd/request/${id}`,
      {
        withCredentials: true,
      },
    );
  }

  downloadLgpdFile(id: string): string {
    // After download, refresh the requests list to update download timestamp
    setTimeout(() => {
      this.cacheService.invalidate(this.CACHE_KEYS.LGPD_REQUESTS);
    }, 1000);
    return `${this.baseUrl}/lgpd/download/${id}`;
  }

  deleteAccount(
    request: DeleteAccountRequest,
  ): Observable<DeleteAccountResponse> {
    return this.http
      .post<DeleteAccountResponse>(
        `${this.baseUrl}/lgpd/delete-account`,
        request,
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          // Invalidate all relevant caches when account deletion is requested
          this.cacheService.invalidate(this.CACHE_KEYS.CURRENT_USER);
          this.cacheService.invalidate(this.CACHE_KEYS.AUTH_STATUS);
          this.cacheService.invalidate(this.CACHE_KEYS.LGPD_REQUESTS);
          this.cacheService.invalidate(this.CACHE_KEYS.ONBOARDING_STATUS);
        }),
      );
  }

  getPendingAccountDeletionRequests(): Observable<AdminDeleteAccountRequest[]> {
    return this.http.get<AdminDeleteAccountRequest[]>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests`,
      {
        withCredentials: true,
      },
    );
  }

  undoAccountDeletionRequest(
    id: string,
  ): Observable<AdminDeleteAccountRequest> {
    return this.http.post<AdminDeleteAccountRequest>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests/${id}/undo`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  deleteAccountNow(id: string): Observable<AdminDeleteAccountRequest> {
    return this.http.post<AdminDeleteAccountRequest>(
      `${this.baseUrl}/lgpd/admin/delete-account-requests/${id}/delete-now`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  // Applications endpoints
  getApplications(): Observable<Application[]> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.APPLICATIONS,
      () =>
        this.http.get<Application[]>(`${this.baseUrl}/auth/applications`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.APPLICATIONS,
      10 * 60 * 1000, // Background refresh after 10 minutes
    );
  }

  // Discord integration methods
  getDiscordAuthUrl(): Observable<DiscordAuthUrl> {
    return this.http.get<DiscordAuthUrl>(`${this.baseUrl}/discord/auth-url`, {
      withCredentials: true,
    });
  }

  getDiscordLinkStatus(): Observable<DiscordLinkStatus> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.DISCORD_STATUS,
      () =>
        this.http.get<DiscordLinkStatus>(`${this.baseUrl}/discord/status`, {
          withCredentials: true,
        }),
      this.CACHE_DURATIONS.DISCORD_STATUS,
    );
  }

  unlinkDiscord(linkId: string): Observable<{ message: string }> {
    return this.http
      .delete<{ message: string }>(`${this.baseUrl}/discord/link/${linkId}`, {
        withCredentials: true,
      })
      .pipe(
        tap(() => {
          // Clear Discord cache on unlink
          this.cacheService.invalidate(this.CACHE_KEYS.DISCORD_STATUS);
        }),
      );
  }

  getDiscordAdminStatus(): Observable<{ isAdmin: boolean }> {
    return this.http.get<{ isAdmin: boolean }>(
      `${this.baseUrl}/discord/admin/status`,
      {
        withCredentials: true,
      },
    );
  }

  registerDiscordMetadata(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/discord/admin/register-metadata`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  // Admin methods for Discord server settings
  getServerSettings(): Observable<ServerSetting[]> {
    return this.cacheService.getOrSet(
      this.CACHE_KEYS.SERVER_SETTINGS,
      () =>
        this.http.get<ServerSetting[]>(
          `${this.baseUrl}/discord/admin/settings`,
          {
            withCredentials: true,
          },
        ),
      this.CACHE_DURATIONS.SERVER_SETTINGS,
    );
  }

  updateServerSetting(
    key: string,
    setting: UpdateServerSetting,
  ): Observable<ServerSetting> {
    return this.http
      .put<ServerSetting>(
        `${this.baseUrl}/discord/admin/settings/${key}`,
        setting,
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          // Clear server settings cache on update
          this.cacheService.invalidate(this.CACHE_KEYS.SERVER_SETTINGS);
        }),
      );
  }

  // Cache management methods
  clearAuthCache(): void {
    this.cacheService.invalidate(this.CACHE_KEYS.CURRENT_USER);
    this.cacheService.invalidate(this.CACHE_KEYS.AUTH_STATUS);
    this.cacheService.invalidate(this.CACHE_KEYS.APPLICATIONS);
    this.cacheService.invalidate(this.CACHE_KEYS.ONBOARDING_STATUS);
  }

  clearUserCache(): void {
    this.cacheService.invalidate(this.CACHE_KEYS.CURRENT_USER);
    this.cacheService.invalidate(this.CACHE_KEYS.ONBOARDING_STATUS);
  }

  clearLgpdCache(): void {
    this.cacheService.invalidate(this.CACHE_KEYS.LGPD_REQUESTS);
  }

  clearDiscordCache(): void {
    this.cacheService.invalidate(this.CACHE_KEYS.DISCORD_STATUS);
    this.cacheService.invalidate(this.CACHE_KEYS.SERVER_SETTINGS);
  }

  clearAllCache(): void {
    this.cacheService.clear();
  }

  // Force refresh methods (bypass cache)
  getCurrentUserFresh(): Observable<User> {
    this.cacheService.invalidate(this.CACHE_KEYS.CURRENT_USER);
    return this.getCurrentUser();
  }

  getApplicationsFresh(): Observable<Application[]> {
    this.cacheService.invalidate(this.CACHE_KEYS.APPLICATIONS);
    return this.getApplications();
  }

  getLgpdRequestsFresh(): Observable<LgpdRequest[]> {
    this.cacheService.invalidate(this.CACHE_KEYS.LGPD_REQUESTS);
    return this.getLgpdRequests();
  }

  getAuthStatusFresh(): Observable<AuthStatus> {
    this.cacheService.invalidate(this.CACHE_KEYS.AUTH_STATUS);
    return this.checkAuth();
  }

  getDiscordLinkStatusFresh(): Observable<DiscordLinkStatus> {
    this.cacheService.invalidate(this.CACHE_KEYS.DISCORD_STATUS);
    return this.getDiscordLinkStatus();
  }

  getServerSettingsFresh(): Observable<ServerSetting[]> {
    this.cacheService.invalidate(this.CACHE_KEYS.SERVER_SETTINGS);
    return this.getServerSettings();
  }

  // Discord Role Management methods
  getDiscordRolesAdmin(): Observable<SelectableRoles> {
    return this.http.get<SelectableRoles>(
      `${this.baseUrl}/discord/roles/admin`,
      {
        withCredentials: true,
      },
    );
  }

  updateDiscordRoleSelection(
    dto: UpdateRoleSelection,
  ): Observable<{ message: string }> {
    return this.http.put<{ message: string }>(
      `${this.baseUrl}/discord/roles/admin/selection`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  syncDiscordRoles(): Observable<{ message: string }> {
    return this.http.post<{ message: string }>(
      `${this.baseUrl}/discord/roles/admin/sync`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getSelectableDiscordRoles(): Observable<DiscordRole[]> {
    return this.http.get<DiscordRole[]>(
      `${this.baseUrl}/discord/roles/selectable`,
      {
        withCredentials: true,
      },
    );
  }

  getUserDiscordRoles(): Observable<UserRoles> {
    return this.http.get<UserRoles>(`${this.baseUrl}/discord/roles/user`, {
      withCredentials: true,
    });
  }

  updateUserDiscordRoles(
    dto: UserRoleSelection,
  ): Observable<RoleSelectionResponse> {
    return this.http.put<RoleSelectionResponse>(
      `${this.baseUrl}/discord/roles/user`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  // Privacy methods
  getPrivacySettings(): Observable<PrivacySetting> {
    return this.http.get<PrivacySetting>(`${this.baseUrl}/privacy/settings`, {
      withCredentials: true,
    });
  }

  updatePrivacySetting(
    settingType: string,
    dto: UpdatePrivacySetting,
  ): Observable<PrivacySetting> {
    return this.http.put<PrivacySetting>(
      `${this.baseUrl}/privacy/settings/${settingType}`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  bulkUpdatePrivacySettings(
    dto: BulkUpdatePrivacySettings,
  ): Observable<PrivacySetting> {
    return this.http.put<PrivacySetting>(
      `${this.baseUrl}/privacy/settings`,
      dto,
      {
        withCredentials: true,
      },
    );
  }

  getCookieBannerStatus(): Observable<CookieBannerStatus> {
    return this.http.get<CookieBannerStatus>(
      `${this.baseUrl}/privacy/cookie-banner/status`,
      {
        withCredentials: true,
      },
    );
  }

  acceptCookieBanner(): Observable<PrivacySetting> {
    return this.http.post<PrivacySetting>(
      `${this.baseUrl}/privacy/cookie-banner/accept`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  initializePrivacySettings(): Observable<PrivacySetting> {
    return this.http.post<PrivacySetting>(
      `${this.baseUrl}/privacy/initialize`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  // Privacy Directive endpoints (PURR-like system)
  getPrivacyDirectives(): Observable<unknown> {
    return this.http.get(`${this.baseUrl}/privacy-directives`, {
      withCredentials: true,
      observe: 'response', // Need headers for directive information
    });
  }

  // Public methods for external access
  getPrivacyPreferences(token: string): Observable<Record<string, boolean>> {
    return this.http.get<Record<string, boolean>>(
      `${this.baseUrl}/privacy/preferences`,
      {
        params: { token },
      },
    );
  }
}
