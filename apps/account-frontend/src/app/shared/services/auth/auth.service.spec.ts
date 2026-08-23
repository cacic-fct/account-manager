import { DOCUMENT } from '@angular/common';
import { PLATFORM_ID, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { environment } from '../../../../environments/environment';
import { ApiService, type PasswordLoginResponse } from '../api.service';
import { CsrfService } from '../csrf.service';
import { LoggerService } from '../logger.service';
import { AuthService } from './auth.service';
import { SilentSsoService } from './silent-sso.service';
import type { User } from '../../interfaces/user.interface';

describe('AuthService password login', () => {
  let apiService: {
    passwordLogin: ReturnType<typeof vi.fn>;
    getCurrentUser: ReturnType<typeof vi.fn>;
    refreshTrackingCookies: ReturnType<typeof vi.fn>;
    clearTrackingCookies: ReturnType<typeof vi.fn>;
    clearAuthCache: ReturnType<typeof vi.fn>;
    clearUserCache: ReturnType<typeof vi.fn>;
    checkAuth: ReturnType<typeof vi.fn>;
    logout: ReturnType<typeof vi.fn>;
  };
  let csrfService: {
    fetchToken: ReturnType<typeof vi.fn>;
    clearToken: ReturnType<typeof vi.fn>;
  };
  let originalProduction: boolean;
  const silentSso = {
    check: vi.fn<() => Promise<'authenticated' | 'unauthenticated'>>(),
  };
  const logger = {
    debug: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };

  const loginResponse: PasswordLoginResponse = {
    success: true,
    isAuthenticated: true,
    isOnboarded: true,
    redirectUrl: 'http://localhost:4200/app/settings',
  };
  const currentUser = {
    id: '22222222-2222-2222-2222-222222222222',
    keycloakId: '22222222-2222-2222-2222-222222222222',
    username: 'aluno@unesp.br',
    email: 'aluno@unesp.br',
    fullname: 'Aluno Unesp',
    displayName: 'Aluno Unesp',
    phone: '+5518999990002',
    identityDocument: '22222222222',
    isForeigner: false,
    isOnboarded: true,
    isAdmin: false,
    adminGroups: [],
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  } satisfies User & { keycloakId: string };

  beforeEach(() => {
    originalProduction = environment.production;
    environment.production = false;

    apiService = {
      passwordLogin: vi.fn().mockReturnValue(of(loginResponse)),
      getCurrentUser: vi.fn().mockReturnValue(of(currentUser)),
      refreshTrackingCookies: vi.fn().mockReturnValue(of({})),
      clearTrackingCookies: vi.fn().mockReturnValue(of({ cleared: true })),
      clearAuthCache: vi.fn(),
      clearUserCache: vi.fn(),
      checkAuth: vi.fn().mockReturnValue(of({ isAuthenticated: false, isOnboarded: false })),
      logout: vi.fn().mockReturnValue(of({ success: true })),
    };
    csrfService = {
      fetchToken: vi.fn().mockReturnValue(of({})),
      clearToken: vi.fn(),
    };
    silentSso.check.mockReset();
    logger.warn.mockReset();

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        {
          provide: ApiService,
          useValue: apiService,
        },
        {
          provide: CsrfService,
          useValue: csrfService,
        },
        {
          provide: SilentSsoService,
          useValue: silentSso,
        },
        {
          provide: LoggerService,
          useValue: logger,
        },
        {
          provide: PLATFORM_ID,
          useValue: 'browser',
        },
      ],
    });

    const document = TestBed.inject(DOCUMENT);
    document.head.innerHTML = '<base href="/app/">';
    sessionStorage.setItem('cacic.silentLoginAttempted', 'true');
  });

  afterEach(() => {
    environment.production = originalProduction;
    sessionStorage.clear();
    TestBed.resetTestingModule();
  });

  it('posts credentials with the app base path and hydrates authenticated state', async () => {
    const service = TestBed.inject(AuthService);

    const result = await firstValueFrom(service.passwordLogin('aluno@unesp.br', '1', '/settings'));

    expect(result).toEqual(loginResponse);
    expect(apiService.passwordLogin).toHaveBeenCalledWith({
      email: 'aluno@unesp.br',
      password: '1',
      returnTo: '/app/settings',
    });
    expect(sessionStorage.getItem('cacic.silentLoginAttempted')).toBeNull();
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isOnboarded()).toBe(true);
    expect(service.currentUser()).toEqual(currentUser);
    expect(csrfService.fetchToken).toHaveBeenCalled();
    expect(apiService.getCurrentUser).toHaveBeenCalled();
    expect(apiService.refreshTrackingCookies).toHaveBeenCalled();
  });

  it('resets loading state when password login fails', async () => {
    const error = new Error('Invalid email or password');
    apiService.passwordLogin.mockReturnValue(throwError(() => error));
    const service = TestBed.inject(AuthService);

    await expect(firstValueFrom(service.passwordLogin('aluno@unesp.br', 'bad'))).rejects.toThrow(error);

    expect(service.isLoading()).toBe(false);
  });

  it('does not call the backend password endpoint in production builds', async () => {
    environment.production = true;
    const service = TestBed.inject(AuthService);

    await expect(firstValueFrom(service.passwordLogin('aluno@unesp.br', '1'))).rejects.toThrow(
      'Password login is available only in development.',
    );

    expect(apiService.passwordLogin).not.toHaveBeenCalled();
  });

  it('completes the initial login wait after one auth status emission', async () => {
    apiService.checkAuth.mockReturnValue(of({ isAuthenticated: false, isOnboarded: false }));
    const service = TestBed.inject(AuthService);

    await service.runInitialLoginSequence();

    expect(apiService.checkAuth).toHaveBeenCalledOnce();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.isLoading()).toBe(false);
  });

  it('does not claim logout when server-side session destruction fails', () => {
    const service = TestBed.inject(AuthService);
    service.updateCurrentUser(currentUser);
    apiService.logout.mockReturnValue(throwError(() => new Error('session store unavailable')));

    service.logout();

    expect(service.isAuthenticated()).toBe(true);
    expect(service.currentUser()).toEqual(currentUser);
    expect(service.logoutError()).toBe('Não foi possível confirmar o encerramento da sessão. Tente novamente.');
    expect(service.isLoading()).toBe(false);
  });

  it('uses the existing redirect check when the iframe SSO check fails', async () => {
    const service = TestBed.inject(AuthService);
    const failure = new Error('Third-party cookies are unavailable');
    silentSso.check.mockRejectedValue(failure);
    const redirectFallback = vi
      .spyOn(service as unknown as { redirectToExistingSsoSession: () => void }, 'redirectToExistingSsoSession')
      .mockImplementation(() => undefined);

    await invokeCheckExistingSsoSession(service);

    expect(redirectFallback).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledWith('Silent SSO check failed; falling back to redirect', failure);
  });

  it('finishes initialization without redirecting when no SSO session exists', async () => {
    const service = TestBed.inject(AuthService);
    silentSso.check.mockResolvedValue('unauthenticated');

    await invokeCheckExistingSsoSession(service);

    expect(service.isAuthenticated()).toBe(false);
    expect(service.isLoading()).toBe(false);
  });

  it('refreshes the local session after a successful iframe SSO check', async () => {
    const service = TestBed.inject(AuthService);
    silentSso.check.mockResolvedValue('authenticated');
    apiService.checkAuth.mockReturnValue(of({ isAuthenticated: true, isOnboarded: true }));

    await invokeCheckExistingSsoSession(service);

    expect(apiService.clearAuthCache).toHaveBeenCalledOnce();
    expect(apiService.checkAuth).toHaveBeenCalledOnce();
    expect(service.isAuthenticated()).toBe(true);
  });

  async function invokeCheckExistingSsoSession(service: AuthService): Promise<void> {
    const check = Reflect.get(service, 'checkExistingSsoSession') as () => Promise<void>;
    await check.call(service);
  }
});
