import { Service, inject } from '@angular/core';
import { CanActivate, Router } from '@angular/router';
import { Observable, catchError, map, of, switchMap } from 'rxjs';
import { ApiService } from '../api.service';
import { AuthService } from './auth.service';
import { LoggerService } from '../logger.service';
import { MatSnackBar } from '@angular/material/snack-bar';
import { getApiErrorMessage } from '../../utils/api-error-message';

@Service()
export class AdminGuard implements CanActivate {
  private apiService = inject(ApiService);
  private authService = inject(AuthService);
  private router = inject(Router);
  private logger = inject(LoggerService);
  private readonly snackBar = inject(MatSnackBar);

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
              this.logger.debug('Admin access granted', { operation: 'admin-guard' });
              return true;
            } else {
              this.logger.warn('Admin access denied', { operation: 'admin-guard' });
              this.snackBar.open(
                'Sua conta não tem acesso à administração. Peça a um administrador para conferir suas permissões.',
                'Fechar',
                { duration: 8000 },
              );
              this.router.navigateByUrl('/applications');
              return false;
            }
          }),
          catchError((error) => {
            this.logger.error('Error checking admin status', error, { operation: 'admin-guard' });
            this.snackBar.open(
              getApiErrorMessage(
                error,
                'Não foi possível verificar seu acesso à administração. Tente abrir esta área novamente em alguns instantes.',
              ),
              'Fechar',
              { duration: 8000 },
            );
            this.router.navigateByUrl('/applications');
            return of(false);
          }),
        );
      }),
    );
  }
}
