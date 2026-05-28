import { Injectable, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, map } from 'rxjs';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class AuthGuard implements CanActivate {
  private authService = inject(AuthService);
  private router = inject(Router);

  canActivate(): Observable<boolean> {
    return this.authService.isDoneLoading$.pipe(
      map(() => {
        const isAuthenticated = this.authService.isAuthenticated();

        if (!isAuthenticated) {
          this.router.navigateByUrl('/login');
          return false;
        }

        return true;
      }),
    );
  }
}
