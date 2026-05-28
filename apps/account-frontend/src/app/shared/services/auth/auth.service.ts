import {
  Injectable,
  inject,
  signal,
  computed,
  PLATFORM_ID,
} from '@angular/core';
import { isPlatformBrowser } from '@angular/common';
import { Router } from '@angular/router';
import {
  Observable,
  BehaviorSubject,
  catchError,
  of,
  tap,
  take,
  filter,
} from 'rxjs';
import { ApiService } from '../api.service';
import { User, AuthStatus } from '../../interfaces/user.interface';
import { CsrfService } from '../csrf.service';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly silentLoginAttemptKey = 'cacic.silentLoginAttempted';
  private apiService = inject(ApiService);
  private router = inject(Router);
  private csrfService = inject(CsrfService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Signals for reactive state management
  private authStatusSignal = signal<AuthStatus>({
    isAuthenticated: false,
    isOnboarded: false,
  });
  private currentUserSignal = signal<User | null>(null);
  private isLoadingSignal = signal<boolean>(false);

  // Computed properties
  public isAuthenticated = computed(
    () => this.authStatusSignal().isAuthenticated,
  );
  public isOnboarded = computed(
    () => this.authStatusSignal().isOnboarded ?? false,
  );
  public currentUser = computed(() => this.currentUserSignal());
  public isLoading = computed(() => this.isLoadingSignal());

  // Observables for compatibility with existing code
  private isAuthenticatedSubject$ = new BehaviorSubject<boolean>(false);
  public isAuthenticated$ = this.isAuthenticatedSubject$.asObservable();

  private isDoneLoadingSubject$ = new BehaviorSubject<boolean>(false);
  public isDoneLoading$ = this.isDoneLoadingSubject$.asObservable();

  public canActivateProtectedRoutes$ = this.isAuthenticated$;

  private checkAuthStatus(attemptSilentLogin = false): void {
    this.isLoadingSignal.set(true);
    this.apiService
      .checkAuth()
      .pipe(
        tap((status) => {
          if (
            status &&
            !status.isAuthenticated &&
            attemptSilentLogin &&
            this.trySilentLogin()
          ) {
            return;
          }

          this.authStatusSignal.set(status);
          this.isAuthenticatedSubject$.next(status.isAuthenticated);
          this.isDoneLoadingSubject$.next(true);
          this.isLoadingSignal.set(false);

          if (status.isAuthenticated) {
            this.clearSilentLoginAttempt();
            // Fetch CSRF token when user is authenticated
            this.csrfService.fetchToken().subscribe({
              error: (err) => console.error('Failed to fetch CSRF token:', err),
            });
            this.loadCurrentUser();
          }
        }),
        catchError(() => {
          if (attemptSilentLogin && this.trySilentLogin()) {
            return of(null);
          }

          this.authStatusSignal.set({
            isAuthenticated: false,
            isOnboarded: false,
          });
          this.isAuthenticatedSubject$.next(false);
          this.isDoneLoadingSubject$.next(true);
          this.isLoadingSignal.set(false);
          return of(null);
        }),
      )
      .subscribe();
  }

  private loadCurrentUser(): void {
    this.apiService
      .getCurrentUser()
      .pipe(
        tap((user) => {
          console.log('Loaded current user from backend:', user);
          this.currentUserSignal.set(user);
          this.authStatusSignal.set({
            isAuthenticated: true,
            isOnboarded: user.isOnboarded ?? false,
          });
        }),
        catchError((error) => {
          console.error('Error loading current user:', error);
          this.currentUserSignal.set(null);
          return of(null);
        }),
      )
      .subscribe();
  }

  public runInitialLoginSequence(): Promise<void> {
    if (!this.isBrowser) {
      // On SSR, skip auth initialization that triggers network requests
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.checkAuthStatus(true);

      // Wait for loading to complete
      this.isDoneLoading$.subscribe((isDone) => {
        if (isDone) {
          resolve();
        }
      });
    });
  }

  public login(targetUrl?: string): void {
    window.location.href = this.apiService.getLoginUrl(targetUrl);
  }

  private trySilentLogin(): boolean {
    if (!this.isBrowser) {
      return false;
    }

    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.get('sso') === 'none' ||
      currentUrl.pathname.includes('/logout') ||
      sessionStorage.getItem(this.silentLoginAttemptKey) === 'true'
    ) {
      return false;
    }

    sessionStorage.setItem(this.silentLoginAttemptKey, 'true');
    window.location.href = this.apiService.getSilentLoginUrl(
      `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    );
    return true;
  }

  private clearSilentLoginAttempt(): void {
    if (this.isBrowser) {
      sessionStorage.removeItem(this.silentLoginAttemptKey);
    }
  }

  public logout(): void {
    this.isLoadingSignal.set(true);
    this.apiService
      .logout()
      .pipe(
        tap(() => {
          // Clear CSRF token on logout
          this.csrfService.clearToken();
          this.authStatusSignal.set({
            isAuthenticated: false,
            isOnboarded: false,
          });
          this.currentUserSignal.set(null);
          this.isAuthenticatedSubject$.next(false);
          this.isLoadingSignal.set(false);
          // Cache is cleared in ApiService logout method
          this.router.navigateByUrl('/login');
        }),
        catchError(() => {
          // Even if logout fails, clear local state and cache
          this.csrfService.clearToken();
          this.apiService.clearAuthCache();
          this.authStatusSignal.set({
            isAuthenticated: false,
            isOnboarded: false,
          });
          this.currentUserSignal.set(null);
          this.isAuthenticatedSubject$.next(false);
          this.isLoadingSignal.set(false);
          this.router.navigateByUrl('/login');
          return of(null);
        }),
      )
      .subscribe();
  }

  public refresh(): void {
    this.checkAuthStatus();
  }

  public hasValidToken(): boolean {
    return this.isAuthenticated();
  }

  // Method to update user after profile completion
  public updateCurrentUser(user: User): void {
    console.log('Updating current user in auth service:', user);
    this.currentUserSignal.set(user);
    this.authStatusSignal.set({
      isAuthenticated: true,
      isOnboarded: user.isOnboarded ?? false,
    });
    // Update cache with new user data
    this.apiService.clearUserCache();
  }

  // Method to refresh auth status from backend
  public refreshAuthStatus(): Promise<void> {
    console.log('Refreshing auth status from backend');
    return new Promise((resolve) => {
      this.isLoadingSignal.set(true);

      // Force fresh auth check by clearing cache first
      this.apiService.clearAuthCache();

      this.apiService
        .checkAuth()
        .pipe(
          tap((status) => {
            console.log('Refreshed auth status:', status);
            this.authStatusSignal.set(status);
            this.isAuthenticatedSubject$.next(status.isAuthenticated);

            if (status.isAuthenticated) {
              this.loadCurrentUser();
            }

            this.isLoadingSignal.set(false);
            this.isDoneLoadingSubject$.next(true);
          }),
          catchError((error) => {
            console.error('Error refreshing auth status:', error);
            this.authStatusSignal.set({
              isAuthenticated: false,
              isOnboarded: false,
            });
            this.isAuthenticatedSubject$.next(false);
            this.isLoadingSignal.set(false);
            this.isDoneLoadingSubject$.next(true);
            return of(null);
          }),
        )
        .subscribe(() => {
          resolve();
        });
    });
  }
}
