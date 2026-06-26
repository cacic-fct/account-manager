import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import type {
  Application,
  AuthStatus,
  CreateUserProfile,
  User,
} from '@cacic/shared-types';
import { CacheService } from '../cache.service';
import { getApiBaseUrl } from '../../utils/api-url.util';
import { API_CACHE_DURATIONS, API_CACHE_KEYS } from './api-cache.constants';

export interface PasswordLoginRequest {
  email: string;
  password: string;
  returnTo?: string;
}

export interface PasswordLoginResponse extends AuthStatus {
  success: true;
  redirectUrl: string;
}

@Injectable({
  providedIn: 'root',
})
export class AuthApiService {
  private readonly baseUrl = getApiBaseUrl();
  private http = inject(HttpClient);
  private cacheService = inject(CacheService);

  getCurrentUser(): Observable<User> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.CURRENT_USER,
      () =>
        this.http.get<User>(`${this.baseUrl}/auth/me`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.CURRENT_USER,
      2 * 60 * 1000,
    );
  }

  updateProfile(profile: CreateUserProfile): Observable<User> {
    return this.http
      .post<User>(`${this.baseUrl}/auth/profile`, profile, {
        withCredentials: true,
      })
      .pipe(
        tap((user) => {
          this.cacheService.set(API_CACHE_KEYS.CURRENT_USER, user);
        }),
      );
  }

  checkAuth(): Observable<AuthStatus> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.AUTH_STATUS,
      () =>
        this.http.get<AuthStatus>(`${this.baseUrl}/auth/check`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.AUTH_STATUS,
      1 * 60 * 1000,
    );
  }

  passwordLogin(
    credentials: PasswordLoginRequest,
  ): Observable<PasswordLoginResponse> {
    return this.http
      .post<PasswordLoginResponse>(
        `${this.baseUrl}/auth/password-login`,
        credentials,
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          this.clearAuthCache();
        }),
      );
  }

  getOnboardingStatus(): Observable<{
    needsOnboarding: boolean;
    missingFields: string[];
  }> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.ONBOARDING_STATUS,
      () =>
        this.http.get<{
          needsOnboarding: boolean;
          missingFields: string[];
        }>(`${this.baseUrl}/auth/onboarding-status`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.ONBOARDING_STATUS,
    );
  }

  checkUnespRoleRequired(): Observable<{
    shouldShowUnespRoleSelection: boolean;
  }> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.UNESP_ROLE_REQUIRED,
      () =>
        this.http.get<{ shouldShowUnespRoleSelection: boolean }>(
          `${this.baseUrl}/auth/unesp-role-required`,
          {
            withCredentials: true,
          },
        ),
      API_CACHE_DURATIONS.UNESP_ROLE_REQUIRED,
    );
  }

  logout(
    postLogoutRedirectUri?: string,
  ): Observable<{ success: boolean; logoutUrl?: string }> {
    return this.http
      .post<{ success: boolean; logoutUrl?: string }>(
        `${this.baseUrl}/auth/logout`,
        {
          ...(postLogoutRedirectUri ? { postLogoutRedirectUri } : {}),
        },
        {
          withCredentials: true,
        },
      )
      .pipe(
        tap(() => {
          this.clearAuthCache();
        }),
      );
  }

  refreshTrackingCookies(): Observable<unknown> {
    return this.http.get(`${this.baseUrl}/tracking/session`, {
      withCredentials: true,
    });
  }

  clearTrackingCookies(): Observable<{ cleared: true }> {
    return this.http.post<{ cleared: true }>(
      `${this.baseUrl}/tracking/clear`,
      {},
      {
        withCredentials: true,
      },
    );
  }

  getLoginUrl(returnUrl?: string): string {
    if (!returnUrl) {
      return `${this.baseUrl}/auth/login/redirect`;
    }

    const query = new URLSearchParams({ returnTo: returnUrl });
    return `${this.baseUrl}/auth/login/redirect?${query.toString()}`;
  }

  getSilentLoginUrl(returnUrl?: string): string {
    const query = new URLSearchParams({ prompt: 'none' });
    if (returnUrl) {
      query.set('returnTo', returnUrl);
    }

    return `${this.baseUrl}/auth/login/redirect?${query.toString()}`;
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

  getAdminStatus(): Observable<{ isAdmin: boolean; adminGroups: string[] }> {
    return this.http.get<{ isAdmin: boolean; adminGroups: string[] }>(
      `${this.baseUrl}/auth/admin-status`,
      {
        withCredentials: true,
      },
    );
  }

  getApplications(): Observable<Application[]> {
    return this.cacheService.getOrSet(
      API_CACHE_KEYS.APPLICATIONS,
      () =>
        this.http.get<Application[]>(`${this.baseUrl}/auth/applications`, {
          withCredentials: true,
        }),
      API_CACHE_DURATIONS.APPLICATIONS,
      10 * 60 * 1000,
    );
  }

  clearAuthCache(): void {
    this.cacheService.invalidate(API_CACHE_KEYS.CURRENT_USER);
    this.cacheService.invalidate(API_CACHE_KEYS.AUTH_STATUS);
    this.cacheService.invalidate(API_CACHE_KEYS.APPLICATIONS);
    this.cacheService.invalidate(API_CACHE_KEYS.ONBOARDING_STATUS);
  }
}
