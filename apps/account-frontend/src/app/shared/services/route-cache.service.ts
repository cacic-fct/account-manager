import { Service, inject } from '@angular/core';
import { Observable, of } from 'rxjs';
import { tap, shareReplay, catchError } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { AuthService } from './auth/auth.service';
import { User } from '../interfaces/user.interface';
import { getApiBaseUrl } from '../utils/api-url.util';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';

interface OnboardingStatus {
  needsOnboarding: boolean;
  missingFields: string[];
}

interface RouteDataCache {
  user: User | null;
  userTimestamp: number;
  onboardingStatus: {
    needsOnboarding: boolean;
    missingFields: string[];
  } | null;
  onboardingTimestamp: number;
}

/**
 * Specialized service for route guards to minimize API calls during navigation.
 * Provides aggressive caching with smart invalidation strategies.
 */
@Service()
export class RouteCacheService {
  private http = inject(HttpClient);
  private authService = inject(AuthService);
  private readonly baseUrl = getApiBaseUrl();
  private apiService = inject(ApiService);
  private logger = inject(LoggerService);

  private cache: RouteDataCache = {
    user: null,
    userTimestamp: 0,
    onboardingStatus: null,
    onboardingTimestamp: 0,
  };

  private readonly CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  /**
   * Get user data with aggressive caching for route guards.
   * Returns cached data immediately if available, optionally triggers background refresh.
   */
  getUserForRouteGuard(requireFresh = false): Observable<User> {
    const now = Date.now();
    const isExpired = now - this.cache.userTimestamp > this.CACHE_DURATION;

    // If we have cached user data and it's not expired
    if (!requireFresh && this.cache.user && !isExpired) {
      return of(this.cache.user);
    }

    // Check if auth service has user data we can use
    const authUser = this.authService.currentUser();
    if (!requireFresh && authUser && !isExpired) {
      this.cache.user = authUser;
      this.cache.userTimestamp = now;
      return of(authUser);
    }

    return this.apiService.getCurrentUserFresh().pipe(
      tap((user) => {
        this.cache.user = user;
        this.cache.userTimestamp = now;
        // Also update auth service
        this.authService.updateCurrentUser(user);
      }),
      shareReplay(1),
      catchError((error) => {
        this.logger.error('Error fetching user for route guard', error);
        // A failed fresh check leaves authentication unknown. Never turn an
        // expired cached identity into an authenticated route decision.
        throw error;
      }),
    );
  }

  /**
   * Get onboarding status with caching.
   */
  getOnboardingStatusForRouteGuard(): Observable<{
    needsOnboarding: boolean;
    missingFields: string[];
  }> {
    const now = Date.now();
    const isExpired = now - this.cache.onboardingTimestamp > this.CACHE_DURATION;

    // Return cached data if available and not expired
    if (this.cache.onboardingStatus && !isExpired) {
      return of(this.cache.onboardingStatus);
    }

    // Fetch fresh onboarding status
    return this.http.get<OnboardingStatus>(`${this.baseUrl}/auth/onboarding-status`).pipe(
      tap((status) => {
        this.cache.onboardingStatus = status;
        this.cache.onboardingTimestamp = now;
      }),
      shareReplay(1),
      catchError((error) => {
        this.logger.error('Error fetching onboarding status for route guard', error);
        // Return safe default
        return of({ needsOnboarding: true, missingFields: [] });
      }),
    );
  }

  /**
   * Check if user is onboarded based on cached data.
   * Falls back to auth service if no cache available.
   */
  isUserOnboardedSync(): boolean {
    if (this.cache.user) {
      return this.cache.user.isOnboarded;
    }
    return this.authService.isOnboarded();
  }

  /**
   * Background refresh of user data (doesn't block current request)
   */
  private backgroundRefreshUser(): void {
    this.http
      .get<User>(`${this.baseUrl}/user/profile`)
      .pipe(
        tap((user) => {
          this.cache.user = user;
          this.cache.userTimestamp = Date.now();
          this.authService.updateCurrentUser(user);
        }),
        catchError((error) => {
          this.logger.debug('Background user refresh failed', error);
          return of(null);
        }),
      )
      .subscribe();
  }

  /**
   * Clear all cached data (call on logout)
   */
  clearCache(): void {
    this.cache = {
      user: null,
      userTimestamp: 0,
      onboardingStatus: null,
      onboardingTimestamp: 0,
    };
  }

  /**
   * Invalidate user cache (call after profile updates)
   */
  invalidateUserCache(): void {
    this.cache.user = null;
    this.cache.userTimestamp = 0;
  }

  /**
   * Invalidate onboarding cache (call after profile completion)
   */
  invalidateOnboardingCache(): void {
    this.cache.onboardingStatus = null;
    this.cache.onboardingTimestamp = 0;
  }
}
