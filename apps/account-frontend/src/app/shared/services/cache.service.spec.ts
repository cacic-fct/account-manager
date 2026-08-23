import { defer, firstValueFrom, of, Subject } from 'rxjs';
import { CacheService } from './cache.service';

describe('CacheService', () => {
  it('shares one in-flight request across concurrent callers', async () => {
    const service = new CacheService();
    let sourceCalls = 0;
    const source = () =>
      defer(() => {
        sourceCalls++;
        return of({ value: 'fresh' });
      });

    const requests = Array.from({ length: 100 }, () => service.getOrSet('current-user', source));
    const results = await Promise.all(requests.map((request$) => firstValueFrom(request$)));

    expect(sourceCalls).toBe(1);
    expect(results.every((result) => result.value === 'fresh')).toBe(true);
  });

  it('coalesces stale-while-revalidate refreshes and preserves the stale value', async () => {
    vi.useFakeTimers();
    try {
      const service = new CacheService();
      const refresh = new Subject<{ value: string }>();
      let sourceCalls = 0;
      const source = () => {
        sourceCalls++;
        return refresh.asObservable();
      };

      service.set('current-user', { value: 'stale' });
      vi.advanceTimersByTime(2_000);

      const first = await firstValueFrom(service.getOrSet('current-user', source, 10_000, 1_000));
      const second = await firstValueFrom(service.getOrSet('current-user', source, 10_000, 1_000));

      expect(first).toEqual({ value: 'stale' });
      expect(second).toEqual({ value: 'stale' });
      expect(sourceCalls).toBe(1);

      refresh.next({ value: 'fresh' });
      refresh.complete();

      expect(service.get<{ value: string }>('current-user')).toEqual({ value: 'fresh' });
    } finally {
      vi.useRealTimers();
    }
  });
});
