import { Injectable, inject } from '@angular/core';
import {
  CanActivate,
  ActivatedRouteSnapshot,
  RouterStateSnapshot,
  Router,
} from '@angular/router';
import { Observable, of } from 'rxjs';
import { map, catchError, switchMap } from 'rxjs/operators';
import { AuthService } from './auth.service';
import { RouteCacheService } from '../route-cache.service';
import { User } from '../../interfaces/user.interface';

@Injectable({ providedIn: 'root' })
export class AuthGuardWithForcedLogin implements CanActivate {
  private authService = inject(AuthService);
  private router = inject(Router);
  private routeCache = inject(RouteCacheService);

  canActivate(
    route: ActivatedRouteSnapshot,
    state: RouterStateSnapshot,
  ): Observable<boolean> {
    return this.authService.isDoneLoading$.pipe(
      switchMap(() => {
        const isAuthenticated = this.authService.isAuthenticated();

        if (!isAuthenticated) {
          console.log('User not authenticated, redirecting to login');
          this.authService.login(state.url);
          return of(false);
        }

        // Check if we already have current user data in memory
        const currentUser = this.authService.currentUser();

        if (currentUser) {
          // Use cached user data if available
          return of(
            this.handleUserAccessSync(currentUser, state, isAuthenticated),
          );
        }

        // Use route cache service for optimized data fetching
        return this.routeCache.getUserForRouteGuard().pipe(
          map((user: User) => {
            // Update auth service with user data
            this.authService.updateCurrentUser(user);
            return this.handleUserAccessSync(user, state, isAuthenticated);
          }),
          catchError((error) => {
            console.error('AuthGuard error fetching user data:', error);
            // Fallback to cached auth service data if backend call fails
            const isOnboarded = this.authService.isOnboarded();

            console.log('AuthGuard fallback to cached data:', {
              isAuthenticated,
              isOnboarded,
              url: state.url,
            });

            // If user is not onboarded according to cached data, redirect to onboarding
            if (
              isAuthenticated &&
              !isOnboarded &&
              !state.url.includes('/onboarding')
            ) {
              console.log(
                'User not onboarded (cached), redirecting to onboarding from:',
                state.url,
              );
              setTimeout(() => {
                this.router.navigateByUrl('/onboarding');
              }, 0);
              return of(false);
            }

            // Otherwise allow access
            return of(true);
          }),
        );
      }),
      catchError((error) => {
        console.error('AuthGuard error:', error);
        this.authService.login(state.url);
        return of(false);
      }),
    );
  }

  private handleUserAccessSync(
    user: User,
    state: RouterStateSnapshot,
    isAuthenticated: boolean,
  ): boolean {
    const isOnboarded = user.isOnboarded;

    console.log('AuthGuard check with user data:', {
      isAuthenticated,
      isOnboarded,
      url: state.url,
      currentUser: user.email,
      userIsOnboarded: user.isOnboarded,
    });

    // If user is authenticated but not onboarded, redirect to onboarding
    if (isAuthenticated && !isOnboarded && !state.url.includes('/onboarding')) {
      console.log(
        'User not onboarded, redirecting to onboarding from:',
        state.url,
      );
      setTimeout(() => {
        this.router.navigateByUrl('/onboarding');
      }, 0);
      return false;
    }

    // If user is onboarded but trying to access onboarding, redirect to applications
    if (isAuthenticated && isOnboarded && state.url.includes('/onboarding')) {
      console.log(
        'User already onboarded, redirecting to applications from onboarding',
      );
      setTimeout(() => {
        this.router.navigateByUrl('/applications');
      }, 0);
      return false;
    }

    console.log('AuthGuard allowing access to:', state.url);
    return true;
  }
}
