import { Router } from '@angular/router';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom, of, throwError } from 'rxjs';
import { AuthGuardWithForcedLogin } from './auth-guard-forced-login.service';
import { AuthService } from './auth.service';
import { RouteCacheService } from '../route-cache.service';
import { LoggerService } from '../logger.service';

describe('AuthGuardWithForcedLogin', () => {
  it('fails closed when fresh user verification fails', async () => {
    const authService = {
      isDoneLoading$: of(true),
      isAuthenticated: vi.fn().mockReturnValue(true),
      currentUser: vi.fn().mockReturnValue({ id: 'stale-user', isOnboarded: true }),
      isOnboarded: vi.fn().mockReturnValue(true),
      login: vi.fn(),
      updateCurrentUser: vi.fn(),
    };
    const routeCache = {
      getUserForRouteGuard: vi.fn().mockReturnValue(throwError(() => new Error('backend unavailable'))),
    };
    const logger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };

    TestBed.configureTestingModule({
      providers: [
        AuthGuardWithForcedLogin,
        { provide: AuthService, useValue: authService },
        { provide: RouteCacheService, useValue: routeCache },
        { provide: Router, useValue: { navigateByUrl: vi.fn() } },
        { provide: LoggerService, useValue: logger },
      ],
    });

    const guard = TestBed.inject(AuthGuardWithForcedLogin);
    const allowed = await firstValueFrom(
      guard.canActivate({} as never, { url: '/applications' } as never),
    );

    expect(allowed).toBe(false);
    expect(routeCache.getUserForRouteGuard).toHaveBeenCalledWith(true);
    expect(authService.login).toHaveBeenCalledWith('/applications');
    expect(logger.error).toHaveBeenCalled();
  });
});
