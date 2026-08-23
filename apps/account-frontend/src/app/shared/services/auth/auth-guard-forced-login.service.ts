import { Service, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { RouteCacheService } from '../route-cache.service';
import { User } from '../../interfaces/user.interface';
import { LoggerService } from '../logger.service';

@Service()
export class AuthGuardWithForcedLogin implements CanActivate {
  private authService = inject(AuthService);
  private router = inject(Router);
  private routeCache = inject(RouteCacheService);
  private logger = inject(LoggerService);

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
    return this.authService.isDoneLoading$.pipe(
      switchMap(() => {
        const isAuthenticated = this.authService.isAuthenticated();

        if (!isAuthenticated) {
          this.logger.info('Auth guard redirecting unauthenticated route', { operation: 'route-guard' });
          this.authService.login(state.url);
          return of(false);
        }

        // Security-sensitive route decisions require a fresh backend identity
        // check; in-memory user state is advisory only.
        return this.routeCache.getUserForRouteGuard(true).pipe(
          map((user: User) => {
            // Update auth service with user data
            this.authService.updateCurrentUser(user);
            return this.handleUserAccessSync(user, state, isAuthenticated);
          }),
          catchError((error) => {
            this.logger.error('Auth guard could not verify current user', error, {
              operation: 'route-guard',
            });
            // The backend state is unknown. Fail closed instead of admitting a
            // route based on stale authentication or onboarding data.
            this.authService.login(state.url);
            return of(false);
          }),
        );
      }),
      catchError((error) => {
        this.logger.error('Auth guard failed', error, { operation: 'route-guard' });
        this.authService.login(state.url);
        return of(false);
      }),
    );
  }

  private handleUserAccessSync(user: User, state: RouterStateSnapshot, isAuthenticated: boolean): boolean {
    const isOnboarded = user.isOnboarded;

    this.logger.debug('Auth guard evaluated current user', {
      operation: 'route-guard',
      isAuthenticated,
      isOnboarded,
      route: state.url,
    });

    // If user is authenticated but not onboarded, redirect to onboarding
    if (isAuthenticated && !isOnboarded && !state.url.includes('/onboarding')) {
      this.logger.info('Auth guard redirecting to onboarding', {
        operation: 'route-guard',
        route: state.url,
      });
      setTimeout(() => {
        this.router.navigateByUrl('/onboarding');
      }, 0);
      return false;
    }

    // If user is onboarded but trying to access onboarding, redirect to applications
    if (isAuthenticated && isOnboarded && state.url.includes('/onboarding')) {
      this.logger.info('Auth guard redirecting onboarded user', {
        operation: 'route-guard',
        route: state.url,
      });
      setTimeout(() => {
        this.router.navigateByUrl('/applications');
      }, 0);
      return false;
    }

    this.logger.debug('Auth guard allowing route', { operation: 'route-guard', route: state.url });
    return true;
  }
}
