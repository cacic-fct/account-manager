import { Service, inject } from '@angular/core';
import { CanActivate, ActivatedRouteSnapshot, RouterStateSnapshot, Router } from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { RouteCacheService } from '../route-cache.service';
import { User } from '../../interfaces/user.interface';
import { LoggerService } from '../logger.service';

@Service()
export class OnboardingGuard implements CanActivate {
  private authService = inject(AuthService);
  private router = inject(Router);
  private routeCache = inject(RouteCacheService);
  private logger = inject(LoggerService);

  canActivate(route: ActivatedRouteSnapshot, state: RouterStateSnapshot): Observable<boolean> {
    return this.authService.isDoneLoading$.pipe(
      switchMap(() => {
        const isAuthenticated = this.authService.isAuthenticated();

        if (!isAuthenticated) {
          this.logger.info('Onboarding guard redirecting unauthenticated route', { operation: 'route-guard' });
          this.authService.login(state.url);
          return of(false);
        }

        return this.routeCache.getUserForRouteGuard(true).pipe(
          map((user: User) => {
            // Update auth service with user data
            this.authService.updateCurrentUser(user);
            return this.handleOnboardingAccessSync(user, isAuthenticated);
          }),
          catchError((error) => {
            this.logger.error('Onboarding guard could not verify current user', error, {
              operation: 'route-guard',
            });
            // An outage must not be treated as proof that onboarding is
            // required. Keep route access closed until identity is verified.
            this.authService.login(state.url);
            return of(false);
          }),
        );
      }),
      catchError((error) => {
        this.logger.error('Onboarding guard failed', error, { operation: 'route-guard' });
        this.authService.login(state.url);
        return of(false);
      }),
    );
  }

  private handleOnboardingAccessSync(user: User, isAuthenticated: boolean): boolean {
    const isOnboarded = user.isOnboarded;

    this.logger.debug('Onboarding guard evaluated current user', {
      operation: 'route-guard',
      isAuthenticated,
      isOnboarded,
    });

    // If user is already onboarded, redirect to applications
    if (isOnboarded) {
      this.logger.info('Onboarding guard redirecting onboarded user', { operation: 'route-guard' });
      setTimeout(() => {
        this.router.navigateByUrl('/applications');
      }, 0);
      return false;
    }

    // User is authenticated but not onboarded, allow access to onboarding
    this.logger.debug('Onboarding guard allowing onboarding route', { operation: 'route-guard' });
    return true;
  }
}
