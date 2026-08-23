import { Component, inject, signal, OnInit, OnDestroy, ChangeDetectionStrategy } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatIconModule } from '@angular/material/icon';
import { Router, NavigationEnd } from '@angular/router';
import { Subscription } from 'rxjs';
import { filter } from 'rxjs/operators';
import { AuthService } from '../shared/services/auth/auth.service';
import { StarPatternGenerator, StarConfig, StarPatternConfig } from './star-pattern-generator';
import { ValuePropositionComponent } from './components/value-proposition.component';
import { StarComponent } from './star.component';
import { CacicLogoComponent } from '../shared/assets/cacic-logo.component';
import { LoggerService } from '../shared/services/logger.service';

@Component({
  selector: 'app-home',
  imports: [
    MatButtonModule,
    MatCardModule,
    MatIconModule,
    StarComponent,
    CacicLogoComponent,
    ValuePropositionComponent,
  ],
  templateUrl: './home.component.html',
  styleUrl: './home.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HomeComponent implements OnInit, OnDestroy {
  readonly isLoggingIn = signal(false);
  readonly stars = signal<StarConfig[]>([]);

  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private readonly logger = inject(LoggerService);
  private authSubscription?: Subscription;
  private loadingSubscription?: Subscription;
  private routerSubscription?: Subscription;

  ngOnInit() {
    this.generateStars();

    // Subscribe to authentication state changes
    this.authSubscription = this.authService.isAuthenticated$.subscribe((isAuthenticated) => {
      if (isAuthenticated) {
        this.logger.debug('Home redirecting authenticated user', { operation: 'home-auth' });
        this.isLoggingIn.set(false);
        this.router.navigate(['/applications']);
      }
    });

    // Subscribe to loading state to reset login button when auth process completes
    this.loadingSubscription = this.authService.isDoneLoading$.subscribe((isDoneLoading) => {
      this.logger.debug('Home auth loading state changed', { operation: 'home-auth', isDoneLoading });
      if (isDoneLoading) {
        this.logger.debug('Home auth loading completed', { operation: 'home-auth' });
        this.isLoggingIn.set(false);
      }
    });

    // Listen to router events to detect when user returns from OAuth provider
    this.routerSubscription = this.router.events
      .pipe(filter((event) => event instanceof NavigationEnd))
      .subscribe((event: NavigationEnd) => {
        this.logger.debug('Home navigation completed', { operation: 'home-navigation', route: event.url });
        if (event.url === '/' || event.url.includes('code=') || event.url.includes('error=')) {
          this.logger.debug('Home detected OAuth return', { operation: 'home-auth' });
          setTimeout(() => {
            this.isLoggingIn.set(false);
          }, 1000);
        }
      });
  }

  ngOnDestroy() {
    this.authSubscription?.unsubscribe();
    this.loadingSubscription?.unsubscribe();
    this.routerSubscription?.unsubscribe();
  }

  login() {
    this.logger.debug('Starting login process', { operation: 'home-login' });

    if (this.isLoggingIn()) {
      this.logger.debug('Login already in progress', { operation: 'home-login' });
      return;
    }

    this.isLoggingIn.set(true);

    const timeoutId = setTimeout(() => {
      this.logger.warn('Login timeout', { operation: 'home-login' });
      this.isLoggingIn.set(false);
    }, 15000);

    try {
      this.authService.login('/app/applications');
    } catch (error) {
      this.logger.error('Login failed immediately', error, { operation: 'home-login' });
      clearTimeout(timeoutId);
      this.isLoggingIn.set(false);
    }
  }

  private generateStars(): void {
    // Generate stars based on a fixed coordinate system (percentage-based)
    // This prevents regeneration on resize and allows smooth scaling
    const baseWidth = 1920; // Base reference width
    const baseHeight = 1080; // Base reference height

    const config: StarPatternConfig = {
      width: baseWidth,
      height: baseHeight,
      minSize: 1,
      maxSize: 2,
      minOpacity: 0.3,
      maxOpacity: 0.9,
      seed: 12345,
    };

    const stars = StarPatternGenerator.generateStars(config);

    // Convert to percentage-based coordinates for smooth resizing
    const percentageStars = stars.map((star: StarConfig) => ({
      ...star,
      x: (star.x / baseWidth) * 100, // Convert to percentage
      y: (star.y / baseHeight) * 100, // Convert to percentage
    }));

    this.stars.set(percentageStars);
  }
}
