import { Service } from '@angular/core';
import { defer, Observable, of, shareReplay, throwError } from 'rxjs';
import { catchError, finalize, tap } from 'rxjs/operators';

export interface CacheConfig {
  maxAge: number; // milliseconds
  key: string;
}

interface CacheEntry<T> {
  data?: T;
  hasData: boolean;
  timestamp: number;
  observable?: Observable<T>;
}

@Service()
export class CacheService {
  private cache = new Map<string, CacheEntry<unknown>>();

  /**
   * Get cached data or execute the source observable if cache is expired/missing.
   * Optionally refresh stale data in the background while returning the last
   * completed value immediately.
   */
  getOrSet<T>(
    key: string,
    source: () => Observable<T>,
    maxAge: number = 5 * 60 * 1000,
    forceRefreshAfter?: number,
  ): Observable<T> {
    const cached = this.cache.get(key);
    const now = Date.now();

    // A completed value remains immediately available during a background
    // refresh. A pending request without a value is returned to all callers.
    if (cached?.hasData && now - cached.timestamp < maxAge) {
      if (forceRefreshAfter && now - cached.timestamp > forceRefreshAfter && !cached.observable) {
        this.backgroundRefresh(key, source, cached);
      }

      return of(cached.data as T);
    }

    if (cached?.observable) {
      return cached.observable as Observable<T>;
    }

    return this.startRequest(key, source, cached);
  }

  /**
   * Background refresh - updates cache without blocking current requests.
   */
  private backgroundRefresh<T>(key: string, source: () => Observable<T>, cached: CacheEntry<unknown>): void {
    if (cached.observable) {
      return;
    }

    this.startRequest(key, source, cached).subscribe({
      // Background refresh errors must not replace the last known value or
      // surface as an unhandled subscription error.
      error: () => undefined,
    });
  }

  private startRequest<T>(key: string, source: () => Observable<T>, stale?: CacheEntry<unknown>): Observable<T> {
    let hasValue = false;
    const request$ = defer(source).pipe(
      tap((data) => {
        hasValue = true;
        this.cache.set(key, {
          data,
          hasData: true,
          timestamp: Date.now(),
        });
      }),
      catchError((error: unknown) => {
        const current = this.cache.get(key);
        if (current?.observable === request$) {
          this.restoreStaleOrDelete(key, stale);
        }
        return throwError(() => error);
      }),
      finalize(() => {
        // Empty observables do not execute the tap above and must not leave a
        // permanent in-flight marker in the cache.
        if (!hasValue) {
          const current = this.cache.get(key);
          if (current?.observable === request$) {
            this.restoreStaleOrDelete(key, stale);
          }
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    this.cache.set(key, {
      data: stale?.data,
      hasData: stale?.hasData ?? false,
      timestamp: stale?.timestamp ?? 0,
      observable: request$,
    });

    return request$;
  }

  private restoreStaleOrDelete(key: string, stale?: CacheEntry<unknown>): void {
    if (stale?.hasData) {
      this.cache.set(key, {
        data: stale.data,
        hasData: true,
        timestamp: stale.timestamp,
      });
      return;
    }

    this.cache.delete(key);
  }

  /**
   * Invalidate cache entry.
   */
  invalidate(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Invalidate multiple cache entries by pattern.
   */
  invalidatePattern(pattern: RegExp): void {
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Clear all cache.
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cached data without making a request (returns null if not cached or expired).
   */
  get<T>(key: string, maxAge: number = 5 * 60 * 1000): T | null {
    const cached = this.cache.get(key);
    const now = Date.now();

    if (cached?.hasData && now - cached.timestamp < maxAge) {
      return cached.data as T;
    }

    return null;
  }

  /**
   * Set cache data manually.
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      hasData: true,
      timestamp: Date.now(),
    });
  }

  /**
   * Check if cache has valid data for key.
   */
  has(key: string, maxAge: number = 5 * 60 * 1000): boolean {
    const cached = this.cache.get(key);
    const now = Date.now();

    return cached?.hasData ? now - cached.timestamp < maxAge : false;
  }
}
