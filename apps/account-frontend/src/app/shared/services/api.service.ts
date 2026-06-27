import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
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
  DiscordLinkStatus,
  DiscordAuthUrl,
  ServerSetting,
  UpdateServerSetting,
  DiscordRole,
  SelectableRoles,
  UpdateRoleSelection,
  UserRoleSelection,
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
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionUser,
  StudentEntityDefinition,
  StudentEntityKey,
  StudentEntityMembership,
  StudentEntityMembershipCreateRequest,
  StudentEntityMembershipUpdateRequest,
  TotpSeed,
  TotpStatus,
} from '@cacic/shared-types';
import { CacheService } from './cache.service';
import { AccountLinkingApiService } from './api/account-linking-api.service';
import {
  AuthApiService,
  type PasswordLoginRequest,
  type PasswordLoginResponse,
} from './api/auth-api.service';
import { API_CACHE_KEYS } from './api/api-cache.constants';
import { DiscordApiService } from './api/discord-api.service';
import { KeycloakPermissionsApiService } from './api/keycloak-permissions-api.service';
import { LgpdApiService } from './api/lgpd-api.service';
import { PrivacyApiService } from './api/privacy-api.service';
import { TotpApiService } from './api/totp-api.service';

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
  KeycloakPermissionDefinition,
  KeycloakPermissionGrant,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  KeycloakPermissionUser,
  StudentEntityDefinition,
  StudentEntityKey,
  StudentEntityMembership,
  StudentEntityMembershipCreateRequest,
  StudentEntityMembershipUpdateRequest,
  TotpSeed,
  TotpStatus,
} from '@cacic/shared-types';
export type { PasswordLoginRequest, PasswordLoginResponse };

@Injectable({
  providedIn: 'root',
})
export class ApiService {
  private cacheService = inject(CacheService);
  private accountLinkingApi = inject(AccountLinkingApiService);
  private authApi = inject(AuthApiService);
  private discordApi = inject(DiscordApiService);
  private keycloakPermissionsApi = inject(KeycloakPermissionsApiService);
  private lgpdApi = inject(LgpdApiService);
  private privacyApi = inject(PrivacyApiService);
  private totpApi = inject(TotpApiService);

  getCurrentUser(): Observable<User> {
    return this.authApi.getCurrentUser();
  }

  updateProfile(profile: CreateUserProfile): Observable<User> {
    return this.authApi.updateProfile(profile);
  }

  checkAuth(): Observable<AuthStatus> {
    return this.authApi.checkAuth();
  }

  passwordLogin(
    credentials: PasswordLoginRequest,
  ): Observable<PasswordLoginResponse> {
    return this.authApi.passwordLogin(credentials);
  }

  getOnboardingStatus(): Observable<{
    needsOnboarding: boolean;
    missingFields: string[];
  }> {
    return this.authApi.getOnboardingStatus();
  }

  checkUnespRoleRequired(): Observable<{
    shouldShowUnespRoleSelection: boolean;
  }> {
    return this.authApi.checkUnespRoleRequired();
  }

  logout(
    postLogoutRedirectUri?: string,
  ): Observable<{ success: boolean; logoutUrl?: string }> {
    return this.authApi.logout(postLogoutRedirectUri);
  }

  refreshTrackingCookies(): Observable<unknown> {
    return this.authApi.refreshTrackingCookies();
  }

  clearTrackingCookies(): Observable<{ cleared: true }> {
    return this.authApi.clearTrackingCookies();
  }

  getLoginUrl(returnUrl?: string): string {
    return this.authApi.getLoginUrl(returnUrl);
  }

  getSilentLoginUrl(returnUrl?: string): string {
    return this.authApi.getSilentLoginUrl(returnUrl);
  }

  consumePostOnboardingRedirect(): Observable<{ redirectUrl: string | null }> {
    return this.authApi.consumePostOnboardingRedirect();
  }

  startGoogleAccountLinking(): Observable<AccountLinkingStartUrl> {
    return this.accountLinkingApi.startGoogleAccountLinking();
  }

  getAccountMergeRequest(id: string): Observable<AccountMergeRequest> {
    return this.accountLinkingApi.getAccountMergeRequest(id);
  }

  confirmAccountMerge(
    id: string,
    dto: ConfirmAccountMergeRequest,
  ): Observable<ConfirmAccountMergeResponse> {
    return this.accountLinkingApi.confirmAccountMerge(id, dto);
  }

  cancelAccountMerge(id: string): Observable<{ success: true }> {
    return this.accountLinkingApi.cancelAccountMerge(id);
  }

  getAdminStatus(): Observable<{ isAdmin: boolean; adminGroups: string[] }> {
    return this.authApi.getAdminStatus();
  }

  createLgpdRequest(): Observable<LgpdRequestDetail> {
    return this.lgpdApi.createLgpdRequest();
  }

  getLgpdRequests(): Observable<LgpdRequest[]> {
    return this.lgpdApi.getLgpdRequests();
  }

  getLgpdRequest(id: string): Observable<LgpdRequestDetail> {
    return this.lgpdApi.getLgpdRequest(id);
  }

  downloadLgpdFile(id: string): string {
    return this.lgpdApi.downloadLgpdFile(id);
  }

  deleteAccount(
    request: DeleteAccountRequest,
  ): Observable<DeleteAccountResponse> {
    return this.lgpdApi.deleteAccount(request);
  }

  getPendingAccountDeletionRequests(): Observable<AdminDeleteAccountRequest[]> {
    return this.lgpdApi.getPendingAccountDeletionRequests();
  }

  undoAccountDeletionRequest(
    id: string,
  ): Observable<AdminDeleteAccountRequest> {
    return this.lgpdApi.undoAccountDeletionRequest(id);
  }

  deleteAccountNow(id: string): Observable<AdminDeleteAccountRequest> {
    return this.lgpdApi.deleteAccountNow(id);
  }

  getKeycloakPermissionCatalog(): Observable<KeycloakPermissionDefinition[]> {
    return this.keycloakPermissionsApi.getKeycloakPermissionCatalog();
  }

  getStudentEntityCatalog(): Observable<StudentEntityDefinition[]> {
    return this.keycloakPermissionsApi.getStudentEntityCatalog();
  }

  searchKeycloakPermissionUsers(
    query: string,
  ): Observable<KeycloakPermissionUser[]> {
    return this.keycloakPermissionsApi.searchKeycloakPermissionUsers(query);
  }

  getKeycloakPermissionGrants(
    userId: string,
  ): Observable<KeycloakPermissionGrant[]> {
    return this.keycloakPermissionsApi.getKeycloakPermissionGrants(userId);
  }

  getUserStudentEntityMemberships(
    userId: string,
  ): Observable<StudentEntityMembership[]> {
    return this.keycloakPermissionsApi.getUserStudentEntityMemberships(userId);
  }

  getStudentEntityMemberships(
    entity?: StudentEntityKey,
  ): Observable<StudentEntityMembership[]> {
    return this.keycloakPermissionsApi.getStudentEntityMemberships(entity);
  }

  createKeycloakPermissionGrant(
    dto: KeycloakPermissionGrantCreateRequest,
  ): Observable<KeycloakPermissionGrant> {
    return this.keycloakPermissionsApi.createKeycloakPermissionGrant(dto);
  }

  createStudentEntityMembership(
    dto: StudentEntityMembershipCreateRequest,
  ): Observable<StudentEntityMembership> {
    return this.keycloakPermissionsApi.createStudentEntityMembership(dto);
  }

  updateKeycloakPermissionGrant(
    id: string,
    dto: KeycloakPermissionGrantUpdateRequest,
  ): Observable<KeycloakPermissionGrant> {
    return this.keycloakPermissionsApi.updateKeycloakPermissionGrant(id, dto);
  }

  updateStudentEntityMembership(
    id: string,
    dto: StudentEntityMembershipUpdateRequest,
  ): Observable<StudentEntityMembership> {
    return this.keycloakPermissionsApi.updateStudentEntityMembership(id, dto);
  }

  deleteKeycloakPermissionGrant(
    id: string,
  ): Observable<{ deleted: true; id: string }> {
    return this.keycloakPermissionsApi.deleteKeycloakPermissionGrant(id);
  }

  deleteStudentEntityMembership(
    id: string,
  ): Observable<{ deleted: true; id: string }> {
    return this.keycloakPermissionsApi.deleteStudentEntityMembership(id);
  }

  syncKeycloakPermissionGrants(): Observable<{ queued: true }> {
    return this.keycloakPermissionsApi.syncKeycloakPermissionGrants();
  }

  getApplications(): Observable<Application[]> {
    return this.authApi.getApplications();
  }

  getDiscordAuthUrl(): Observable<DiscordAuthUrl> {
    return this.discordApi.getDiscordAuthUrl();
  }

  getDiscordLinkStatus(): Observable<DiscordLinkStatus> {
    return this.discordApi.getDiscordLinkStatus();
  }

  unlinkDiscord(linkId: string): Observable<{ message: string }> {
    return this.discordApi.unlinkDiscord(linkId);
  }

  getDiscordAdminStatus(): Observable<{ isAdmin: boolean }> {
    return this.discordApi.getDiscordAdminStatus();
  }

  getServerSettings(): Observable<ServerSetting[]> {
    return this.discordApi.getServerSettings();
  }

  updateServerSetting(
    key: string,
    setting: UpdateServerSetting,
  ): Observable<ServerSetting> {
    return this.discordApi.updateServerSetting(key, setting);
  }

  clearAuthCache(): void {
    this.authApi.clearAuthCache();
  }

  clearUserCache(): void {
    this.cacheService.invalidate(API_CACHE_KEYS.CURRENT_USER);
    this.cacheService.invalidate(API_CACHE_KEYS.ONBOARDING_STATUS);
  }

  clearLgpdCache(): void {
    this.cacheService.invalidate(API_CACHE_KEYS.LGPD_REQUESTS);
  }

  clearDiscordCache(): void {
    this.cacheService.invalidate(API_CACHE_KEYS.DISCORD_STATUS);
    this.cacheService.invalidate(API_CACHE_KEYS.SERVER_SETTINGS);
  }

  clearAllCache(): void {
    this.cacheService.clear();
  }

  getCurrentUserFresh(): Observable<User> {
    this.cacheService.invalidate(API_CACHE_KEYS.CURRENT_USER);
    return this.getCurrentUser();
  }

  getApplicationsFresh(): Observable<Application[]> {
    this.cacheService.invalidate(API_CACHE_KEYS.APPLICATIONS);
    return this.getApplications();
  }

  getLgpdRequestsFresh(): Observable<LgpdRequest[]> {
    this.cacheService.invalidate(API_CACHE_KEYS.LGPD_REQUESTS);
    return this.getLgpdRequests();
  }

  getAuthStatusFresh(): Observable<AuthStatus> {
    this.cacheService.invalidate(API_CACHE_KEYS.AUTH_STATUS);
    return this.checkAuth();
  }

  getDiscordLinkStatusFresh(): Observable<DiscordLinkStatus> {
    this.cacheService.invalidate(API_CACHE_KEYS.DISCORD_STATUS);
    return this.getDiscordLinkStatus();
  }

  getServerSettingsFresh(): Observable<ServerSetting[]> {
    this.cacheService.invalidate(API_CACHE_KEYS.SERVER_SETTINGS);
    return this.getServerSettings();
  }

  getDiscordRolesAdmin(): Observable<SelectableRoles> {
    return this.discordApi.getDiscordRolesAdmin();
  }

  updateDiscordRoleSelection(
    dto: UpdateRoleSelection,
  ): Observable<{ message: string }> {
    return this.discordApi.updateDiscordRoleSelection(dto);
  }

  syncDiscordRoles(): Observable<{ message: string }> {
    return this.discordApi.syncDiscordRoles();
  }

  getSelectableDiscordRoles(): Observable<DiscordRole[]> {
    return this.discordApi.getSelectableDiscordRoles();
  }

  getUserDiscordRoles(): Observable<UserRoles> {
    return this.discordApi.getUserDiscordRoles();
  }

  updateUserDiscordRoles(
    dto: UserRoleSelection,
  ): Observable<RoleSelectionResponse> {
    return this.discordApi.updateUserDiscordRoles(dto);
  }

  getPrivacySettings(): Observable<PrivacySetting> {
    return this.privacyApi.getPrivacySettings();
  }

  updatePrivacySetting(
    settingType: string,
    dto: UpdatePrivacySetting,
  ): Observable<PrivacySetting> {
    return this.privacyApi.updatePrivacySetting(settingType, dto);
  }

  bulkUpdatePrivacySettings(
    dto: BulkUpdatePrivacySettings,
  ): Observable<PrivacySetting> {
    return this.privacyApi.bulkUpdatePrivacySettings(dto);
  }

  getCookieBannerStatus(): Observable<CookieBannerStatus> {
    return this.privacyApi.getCookieBannerStatus();
  }

  acceptCookieBanner(): Observable<PrivacySetting> {
    return this.privacyApi.acceptCookieBanner();
  }

  initializePrivacySettings(): Observable<PrivacySetting> {
    return this.privacyApi.initializePrivacySettings();
  }

  getPrivacyDirectives(): Observable<unknown> {
    return this.privacyApi.getPrivacyDirectives();
  }

  getPrivacyPreferences(token: string): Observable<Record<string, boolean>> {
    return this.privacyApi.getPrivacyPreferences(token);
  }

  getTotpStatus(): Observable<TotpStatus> {
    return this.totpApi.getStatus();
  }

  getOrCreateTotpSeed(): Observable<TotpSeed> {
    return this.totpApi.getOrCreateSeed();
  }

  rotateTotpSeed(): Observable<TotpSeed> {
    return this.totpApi.rotateSeed();
  }

  disableTotpSeed(): Observable<TotpStatus> {
    return this.totpApi.disableSeed();
  }
}
