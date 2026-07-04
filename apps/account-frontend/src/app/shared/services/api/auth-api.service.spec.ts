import { provideZonelessChangeDetection } from '@angular/core';
import { provideHttpClient, withXhr } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthApiService } from './auth-api.service';
import { API_CACHE_KEYS } from './api-cache.constants';
import { CacheService } from '../cache.service';

describe('AuthApiService', () => {
  let httpMock: HttpTestingController;
  let cacheService: {
    getOrSet: ReturnType<typeof vi.fn>;
    set: ReturnType<typeof vi.fn>;
    invalidate: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    cacheService = {
      getOrSet: vi.fn((_key: string, factory: () => unknown) => factory()),
      set: vi.fn(),
      invalidate: vi.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        provideZonelessChangeDetection(),
        provideHttpClient(withXhr()),
        provideHttpClientTesting(),
        {
          provide: CacheService,
          useValue: cacheService,
        },
      ],
    });

    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('posts development password login credentials with session cookies and clears auth caches', () => {
    const service = TestBed.inject(AuthApiService);
    const credentials = {
      email: 'aluno@unesp.br',
      password: '1',
      returnTo: '/app/settings',
    };
    let received:
      | {
          success: true;
          isAuthenticated: boolean;
          isOnboarded: boolean;
          redirectUrl: string;
        }
      | undefined;

    service.passwordLogin(credentials).subscribe((response) => {
      received = response;
    });

    const request = httpMock.expectOne('http://localhost:3000/api/auth/password-login');
    expect(request.request.method).toBe('POST');
    expect(request.request.withCredentials).toBe(true);
    expect(request.request.body).toEqual(credentials);

    request.flush({
      success: true,
      isAuthenticated: true,
      isOnboarded: true,
      redirectUrl: 'http://localhost:4200/app/settings',
    });

    expect(received).toEqual({
      success: true,
      isAuthenticated: true,
      isOnboarded: true,
      redirectUrl: 'http://localhost:4200/app/settings',
    });
    expect(cacheService.invalidate).toHaveBeenCalledWith(API_CACHE_KEYS.CURRENT_USER);
    expect(cacheService.invalidate).toHaveBeenCalledWith(API_CACHE_KEYS.AUTH_STATUS);
    expect(cacheService.invalidate).toHaveBeenCalledWith(API_CACHE_KEYS.APPLICATIONS);
    expect(cacheService.invalidate).toHaveBeenCalledWith(API_CACHE_KEYS.ONBOARDING_STATUS);
  });
});
