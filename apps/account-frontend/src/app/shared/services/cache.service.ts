import { Service } from '@angular/core';
import { Observable, of, shareReplay, throwError } from 'rxjs';
import { tap, catchError } from 'rxjs/operators';

export interface CacheConfig {
  maxAge: number; // milliseconds
  key: string;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
  observable?: Observable<T>;
}

@Service()
export class CacheService {
  private cache = new Map<string, CacheEntry<any>>();

  /**
   * Get cached data or execute the source observable if cache is expired/missing
   * Optionally force refresh if data is stale but still valid
   */
  getOrSet<T>(
    key: string,
    source: () => Observable<T>,
    maxAge: number = 5 * 60 * 1000, // 5 minutes default
    forceRefreshAfter?: number, // Optional: force refresh if older than this (but still serve stale data immediately)
  ): Observable<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    // Check if we have valid cached data
    if (cached && now - cached.timestamp < maxAge) {
      // If there's an ongoing request, return that observable
      if (cached.observable) {
        return cached.observable as Observable<T>;
      }

      // If data is stale but still valid, and we have a force refresh threshold
      if (forceRefreshAfter && now - cached.timestamp > forceRefreshAfter) {
        // Return cached data immediately, but trigger background refresh
        this.backgroundRefresh(key, source);
      }

      // Return cached data
      return of(cached.data as T);
    }

    // Create new request observable with shareReplay to avoid multiple simultaneous requests
    const request$ = source().pipe(
      tap((data) => {
        // Update cache with new data
        this.cache.set(key, {
          data,
          timestamp: Date.now(),
        });
      }),
      catchError((error: unknown) => {
        this.cache.delete(key);
        return throwError(() => error);
      }),
      shareReplay(1),
    );

    // Store the ongoing observable to prevent duplicate requests
    this.cache.set(key, {
      data: cached?.data,
      timestamp: cached?.timestamp || 0,
      observable: request$,
    });

    return request$;
  }

  /**
   * Background refresh - updates cache without blocking current request
   */
  private backgroundRefresh<T>(key: string, source: () => Observable<T>): void {
    const cached = this.cache.get(key);

    // Only refresh if there's no ongoing request
    if (!cached?.observable) {
      source()
        .pipe(
          tap((data) => {
            this.cache.set(key, {
              data,
              timestamp: Date.now(),
            });
          }),
          // Don't propagate errors to avoid console noise
          catchError(() => of(null)),
        )
        .subscribe();
    }
  }

  /**
   * Invalidate cache entry
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate multiple cache entries by pattern
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cached data without making a request (returns null if not cached or expired)
   */
  get<T>(key: string, maxAge: number = 5 * 60 * 1000): T | null {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached && now - cached.timestamp < maxAge) {
      return cached.data as T;
    }

    return null;
  }

  /**
   * Set cache data manually
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if cache has valid data for key
   */
  has(key: string, maxAge: number = 5 * 60 * 1000): boolean {
    const cached = this.cache.get(key);
    const now = Date.now();

    return cached ? now - cached.timestamp < maxAge : false;
  }
}
