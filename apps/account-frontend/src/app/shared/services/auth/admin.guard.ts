import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { ApiService } from '../api.service';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AdminGuard implements CanActivate {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private router = inject(Router);

  canActivate(): Observable<boolean> {
    // First check if user is authenticated
    return this.authService.isDoneLoading$.pipe(
      switchMap(() => {
        const isAuthenticated = this.authService.isAuthenticated();

        if (!isAuthenticated) {
          this.router.navigateByUrl('/login');
          return of(false);
        }

        // Check admin status
        return this.apiService.getAdminStatus().pipe(
          map((adminStatus) => {
            if (adminStatus.isAdmin) {
              console.log('Admin access granted:', adminStatus);
              return true;
            } else {
              console.warn('Admin access denied - user not in admin groups');
              this.router.navigateByUrl('/applications');
              return false;
            }
          }),
          catchError((error) => {
            console.error('Error checking admin status:', error);
            this.router.navigateByUrl('/applications');
            return of(false);
          }),
        );
      }),
    );
  }
}
