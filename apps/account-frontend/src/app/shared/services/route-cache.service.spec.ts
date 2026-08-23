import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, throwError } from 'rxjs';
import { AuthService } from './auth/auth.service';
import { RouteCacheService } from './route-cache.service';
import { ApiService } from './api.service';
import { LoggerService } from './logger.service';

describe('RouteCacheService', () => {
  it('does not admit stale identity when a fresh user check fails', async () => {
    const cachedUser = { id: 'cached-user', isOnboarded: true };
    const apiService = {
      getCurrentUserFresh: vi.fn().mockReturnValue(throwError(() => new Error('backend unavailable'))),
    };
    const authService = {
      currentUser: vi.fn().mockReturnValue(cachedUser),
      updateCurrentUser: vi.fn(),
      isOnboarded: vi.fn().mockReturnValue(true),
    };
    const logger = { error: vi.fn(), debug: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        RouteCacheService,
        { provide: HttpClient, useValue: {} },
        { provide: ApiService, useValue: apiService },
        { provide: AuthService, useValue: authService },
        { provide: LoggerService, useValue: logger },
      ],
    });

    const service = TestBed.inject(RouteCacheService);

    await expect(firstValueFrom(service.getUserForRouteGuard())).rejects.toThrow('backend unavailable');
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
