import { Service, inject, signal, computed, PLATFORM_ID } from '@angular/core';
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { BehaviorSubject, catchError, filter, firstValueFrom, Observable, of, take, tap, throwError } from 'rxjs';
import { ApiService, type PasswordLoginResponse } from '../api.service';
import { User, AuthStatus } from '../../interfaces/user.interface';
import { CsrfService } from '../csrf.service';
import { environment } from '../../../../environments/environment';
import { LoggerService } from '../logger.service';

@Service()
export class AuthService {
  private readonly silentLoginAttemptKey = 'cacic.silentLoginAttempted';
  private apiService = inject(ApiService);
  private document = inject(DOCUMENT);
  private csrfService = inject(CsrfService);
  private logger = inject(LoggerService);
  private isBrowser = isPlatformBrowser(inject(PLATFORM_ID));

  // Signals for reactive state management
  private authStatusSignal = signal<AuthStatus>({
    isAuthenticated: false,
    isOnboarded: false,
  });
  private currentUserSignal = signal<User | null>(null);
  private isLoadingSignal = signal<boolean>(false);

  // Computed properties
  public isAuthenticated = computed(() => this.authStatusSignal().isAuthenticated);
  public isOnboarded = computed(() => this.authStatusSignal().isOnboarded ?? false);
  public currentUser = computed(() => this.currentUserSignal());
  public isLoading = computed(() => this.isLoadingSignal());
  private logoutErrorSignal = signal<string | null>(null);
  public logoutError = computed(() => this.logoutErrorSignal());

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
          if (status && !status.isAuthenticated && attemptSilentLogin && this.trySilentLogin()) {
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
              error: (err) => this.logger.error('Failed to fetch CSRF token', err, { operation: 'auth-csrf' }),
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
          this.logger.debug('Loaded current user from backend', { operation: 'auth-load-user', userId: user.id });
          this.currentUserSignal.set(user);
          this.authStatusSignal.set({
            isAuthenticated: true,
            isOnboarded: user.isOnboarded ?? false,
          });
          this.refreshTrackingCookies();
        }),
        catchError((error) => {
          this.logger.error('Error loading current user', error, { operation: 'auth-load-user' });
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

    this.isDoneLoadingSubject$.next(false);
    this.checkAuthStatus(true);

    // This is a one-shot bootstrap wait. Complete the subscription as soon as
    // the current auth check finishes, even if the service is reused later.
    return firstValueFrom(this.isDoneLoading$.pipe(filter(Boolean), take(1))).then(() => undefined);
  }

  public login(targetUrl?: string): void {
    this.clearSilentLoginAttempt();
    window.location.href = this.apiService.getLoginUrl(this.resolveApplicationReturnPath(targetUrl));
  }

  public passwordLogin(email: string, password: string, targetUrl?: string): Observable<PasswordLoginResponse> {
    if (environment.production) {
      return throwError(() => new Error('Password login is available only in development.'));
    }

    this.isLoadingSignal.set(true);
    this.clearSilentLoginAttempt();

    return this.apiService
      .passwordLogin({
        email,
        password,
        returnTo: this.resolveApplicationReturnPath(targetUrl),
      })
      .pipe(
        tap((result: PasswordLoginResponse) => {
          this.authStatusSignal.set({
            isAuthenticated: result.isAuthenticated,
            isOnboarded: result.isOnboarded,
          });
          this.isAuthenticatedSubject$.next(result.isAuthenticated);
          this.isDoneLoadingSubject$.next(true);
          this.isLoadingSignal.set(false);

          if (result.isAuthenticated) {
            this.csrfService.fetchToken().subscribe({
              error: (err) => this.logger.error('Failed to fetch CSRF token', err, { operation: 'auth-csrf' }),
            });
            this.loadCurrentUser();
          }
        }),
        catchError((error) => {
          this.isLoadingSignal.set(false);
          this.isDoneLoadingSubject$.next(true);
          return throwError(() => error);
        }),
      );
  }

  private trySilentLogin(): boolean {
    if (!this.isBrowser) {
      return false;
    }

    const currentUrl = new URL(window.location.href);
    if (
      currentUrl.searchParams.get('sso') === 'none' ||
      sessionStorage.getItem(this.silentLoginAttemptKey) === 'true'
    ) {
      return false;
    }

    sessionStorage.setItem(this.silentLoginAttemptKey, 'true');
    window.location.href = this.apiService.getSilentLoginUrl(
      this.resolveApplicationReturnPath(`${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`),
    );
    return true;
  }

  private clearSilentLoginAttempt(): void {
    if (this.isBrowser) {
      sessionStorage.removeItem(this.silentLoginAttemptKey);
    }
  }

  private markSilentLoginAttempt(): void {
    if (this.isBrowser) {
      sessionStorage.setItem(this.silentLoginAttemptKey, 'true');
    }
  }

  public logout(): void {
    this.isLoadingSignal.set(true);
    this.logoutErrorSignal.set(null);
    const postLogoutRedirectUri = this.isBrowser ? this.getApplicationRootUrl() : undefined;
    this.apiService
      .logout(postLogoutRedirectUri)
      .pipe(
        tap((result) => {
          if (!result.success) {
            throw new Error('The server did not confirm logout.');
          }

          this.clearLocalSession();
          this.clearTrackingCookies();
          this.markSilentLoginAttempt();
          if (this.isBrowser && result.logoutUrl) {
            window.location.assign(result.logoutUrl);
            return;
          }

          if (this.isBrowser && postLogoutRedirectUri) {
            window.location.assign(postLogoutRedirectUri);
          }
        }),
        catchError((error) => {
          // Do not claim logout or discard the local session until the server
          // confirms that its cookie-backed session was destroyed. The user can
          // retry while this warning remains available to the shell.
          this.logoutErrorSignal.set('Não foi possível confirmar o encerramento da sessão. Tente novamente.');
          this.logger.error('Server logout could not be confirmed', error, { operation: 'auth-logout' });
          this.isLoadingSignal.set(false);
          return of(null);
        }),
      )
      .subscribe();
  }

  private getApplicationRootUrl(): string {
    return new URL(this.getApplicationBasePath(), window.location.origin).toString();
  }

  private getApplicationBasePath(): string {
    const baseHref = this.document.querySelector('base')?.getAttribute('href') ?? '/';
    const basePath = new URL(baseHref, window.location.origin).pathname;

    return basePath.endsWith('/') ? basePath : `${basePath}/`;
  }

  private resolveApplicationReturnPath(targetUrl?: string): string | undefined {
    if (!this.isBrowser || !targetUrl) {
      return targetUrl;
    }

    const candidate = targetUrl.trim();
    if (!candidate) {
      return undefined;
    }

    if (candidate.startsWith('//') || /^[a-z][a-z\d+.-]*:/i.test(candidate)) {
      return candidate;
    }

    if (!candidate.startsWith('/')) {
      return candidate;
    }

    const basePath = this.getApplicationBasePath();
    const baseRoot = basePath.endsWith('/') ? basePath.slice(0, -1) : basePath;

    if (basePath === '/' || candidate === baseRoot || candidate.startsWith(basePath)) {
      return candidate;
    }

    return `${basePath}${candidate.replace(/^\/+/, '')}`;
  }

  public clearLocalSession(): void {
    this.csrfService.clearToken();
    this.apiService.clearAuthCache();
    this.clearSilentLoginAttempt();
    this.authStatusSignal.set({
      isAuthenticated: false,
      isOnboarded: false,
    });
    this.currentUserSignal.set(null);
    this.logoutErrorSignal.set(null);
    this.isAuthenticatedSubject$.next(false);
    this.isDoneLoadingSubject$.next(true);
    this.isLoadingSignal.set(false);
  }

  public refresh(): void {
    this.checkAuthStatus();
  }

  public hasValidToken(): boolean {
    return this.isAuthenticated();
  }

  // Method to update user after profile completion
  public updateCurrentUser(user: User): void {
    this.logger.debug('Updating current user in auth service', { operation: 'auth-update-user', userId: user.id });
    this.currentUserSignal.set(user);
    this.authStatusSignal.set({
      isAuthenticated: true,
      isOnboarded: user.isOnboarded ?? false,
    });
    // Update cache with new user data
    this.apiService.clearUserCache();
    this.refreshTrackingCookies();
  }

  // Method to refresh auth status from backend
  public refreshAuthStatus(): Promise<void> {
    this.logger.debug('Refreshing auth status from backend', { operation: 'auth-refresh' });
    return new Promise((resolve) => {
      this.isLoadingSignal.set(true);

      // Force fresh auth check by clearing cache first
      this.apiService.clearAuthCache();

      this.apiService
        .checkAuth()
        .pipe(
          tap((status) => {
            this.logger.debug('Refreshed auth status', {
              operation: 'auth-refresh',
              isAuthenticated: status.isAuthenticated,
            });
            this.authStatusSignal.set(status);
            this.isAuthenticatedSubject$.next(status.isAuthenticated);

            if (status.isAuthenticated) {
              this.loadCurrentUser();
            }

            this.isLoadingSignal.set(false);
            this.isDoneLoadingSubject$.next(true);
          }),
          catchError((error) => {
            this.logger.error('Error refreshing auth status', error, { operation: 'auth-refresh' });
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

  private refreshTrackingCookies(): void {
    this.apiService.refreshTrackingCookies().subscribe({
      next: () => this.notifyTrackingConsentChanged(),
      error: () => undefined,
    });
  }

  private clearTrackingCookies(): void {
    this.clearClientTrackingCookies();
    this.apiService.clearTrackingCookies().subscribe({
      next: () => this.notifyTrackingConsentChanged(),
      error: () => this.notifyTrackingConsentChanged(),
    });
  }

  private clearClientTrackingCookies(): void {
    if (!this.isBrowser) {
      return;
    }

    for (const cookieName of ['cacic-analytics-id', 'cacic-analytics-consent', 'cacic-purr', 'cacic-purr-quick']) {
      this.expireCookie(cookieName);
      this.expireCookie(cookieName, '.cacic.com.br');
    }
  }

  private expireCookie(name: string, domain?: string): void {
    const domainPart = domain ? `; domain=${domain}` : '';
    document.cookie = `${name}=; Max-Age=0; path=/${domainPart}; SameSite=Lax`;
  }

  private notifyTrackingConsentChanged(): void {
    if (!this.isBrowser) {
      return;
    }

    window.dispatchEvent(new CustomEvent('cacicTrackingConsentChanged'));
  }
}
