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
import { ApiService } from '../api.service';
import { User } from '../../interfaces/user.interface';

@Injectable({ providedIn: 'root' })
export class OnboardingGuard implements CanActivate {
  private authService = inject(AuthService);
  private router = inject(Router);
  private apiService = inject(ApiService);

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
          return this.handleOnboardingAccess(currentUser, isAuthenticated);
        }

        // If no cached user data, fetch from API (will use cache if available)
        return this.apiService.getCurrentUser().pipe(
          map((user: User) => {
            // Update auth service with user data
            this.authService.updateCurrentUser(user);
            return this.handleOnboardingAccessSync(user, isAuthenticated);
          }),
          catchError((error) => {
            console.error('OnboardingGuard error fetching user data:', error);

            // Fallback to cached auth service data if backend call fails
            const isOnboarded = this.authService.isOnboarded();
            const cachedUser = this.authService.currentUser();

            console.log('OnboardingGuard fallback to cached data:', {
              isAuthenticated,
              isOnboarded,
              currentUser: cachedUser?.email,
            });

            // If user is already onboarded according to cache, redirect to applications
            if (isOnboarded) {
              console.log(
                'User already onboarded (cached), redirecting to applications',
              );
              setTimeout(() => {
                this.router.navigateByUrl('/applications');
              }, 0);
              return of(false);
            }

            // Otherwise allow access to onboarding
            return of(true);
          }),
        );
      }),
      catchError((error) => {
        console.error('OnboardingGuard error:', error);
        this.authService.login(state.url);
        return of(false);
      }),
    );
  }

  private handleOnboardingAccess(
    user: User,
    isAuthenticated: boolean,
  ): Observable<boolean> {
    return of(this.handleOnboardingAccessSync(user, isAuthenticated));
  }

  private handleOnboardingAccessSync(
    user: User,
    isAuthenticated: boolean,
  ): boolean {
    const isOnboarded = user.isOnboarded;

    console.log('OnboardingGuard check with user data:', {
      isAuthenticated,
      isOnboarded,
      currentUser: user.email,
      userHasData: !!user,
      userPhone: user.phone,
      userFullname: user.fullname,
      userDisplayName: user.displayName,
      userIdentityDocument: user.identityDocument,
    });

    // If user is already onboarded, redirect to applications
    if (isOnboarded) {
      console.log('User already onboarded, redirecting to applications');
      setTimeout(() => {
        this.router.navigateByUrl('/applications');
      }, 0);
      return false;
    }

    // User is authenticated but not onboarded, allow access to onboarding
    console.log('User needs onboarding, allowing access');
    return true;
  }
}
