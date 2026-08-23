import { ConfigService } from '@nestjs/config';
import type { RedisService } from '../../redis/redis.service';
import {
  ExternalVerificationResilienceService,
  ExternalVerificationUnavailableError,
} from './external-verification-resilience.service';

interface RedisValue {
  value: string;
  expiresAt?: number;
}

const createSharedRedis = () => {
  const values = new Map<string, RedisValue>();
  const read = (key: string): string | null => {
    const entry = values.get(key);
    if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
      values.delete(key);
      return null;
    }
    return entry?.value ?? null;
  };
  const get = jest.fn((key: string): Promise<string | null> => Promise.resolve(read(key)));
  const set = jest.fn((key: string, value: string, ttl?: number): Promise<void> => {
    values.set(key, { value, expiresAt: ttl === undefined ? undefined : Date.now() + ttl * 1000 });
    return Promise.resolve();
  });
  const ttl = jest.fn((key: string): Promise<number> => {
    const entry = values.get(key);
    if (!entry) return Promise.resolve(-2);
    if (entry.expiresAt === undefined) return Promise.resolve(-1);
    if (entry.expiresAt <= Date.now()) {
      values.delete(key);
      return Promise.resolve(-2);
    }
    return Promise.resolve(Math.ceil((entry.expiresAt - Date.now()) / 1000));
  });
  const redis = {
    get,
    set,
    setIfAbsent: jest.fn((key: string, value: string, ttlSeconds: number): Promise<boolean> => {
      if (read(key)) return Promise.resolve(false);
      void set(key, value, ttlSeconds);
      return Promise.resolve(true);
    }),
    del: jest.fn((key: string): Promise<number> => Promise.resolve(values.delete(key) ? 1 : 0)),
    ttl,
    incrementWithExpiry: jest.fn((key: string, ttlSeconds: number): Promise<number> => {
      const current = Number(read(key) ?? 0) + 1;
      const previousEntry = values.get(key);
      const previousTtl =
        current === 1 || previousEntry?.expiresAt === undefined
          ? ttlSeconds
          : Math.ceil((previousEntry.expiresAt - Date.now()) / 1000);
      void set(key, String(current), previousTtl > 0 ? previousTtl : ttlSeconds);
      return Promise.resolve(current);
    }),
  };
  return redis as typeof redis & RedisService;
};

const createService = (redis: RedisService, values: Record<string, string> = {}) =>
  new ExternalVerificationResilienceService(
    {
      get: (name: string) => values[name],
    } as ConfigService,
    redis,
  );

describe('ExternalVerificationResilienceService', () => {
  it.each(['false', '0', 'no', 'off'])('honors the hard kill switch value %s', (value) => {
    const service = createService(createSharedRedis(), { UNIVERSITY_EXTERNAL_VERIFICATION_ENABLED: value });
    expect(() => service.assertAvailable()).toThrow(ExternalVerificationUnavailableError);
    expect(service.getStatus()).toMatchObject({ enabled: false, state: 'disabled' });
  });

  it('shares circuit opening across replicas and expires the open state', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const values = {
        UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD: '2',
        UNIVERSITY_EXTERNAL_CIRCUIT_RESET_MS: '1000',
      };
      const replicaA = createService(redis, values);
      const replicaB = createService(redis, values);

      await expect(replicaA.execute('captcha', async () => Promise.reject(new Error('offline')))).rejects.toMatchObject(
        { reason: 'upstream_failure' },
      );
      await expect(replicaA.execute('captcha', async () => Promise.reject(new Error('offline')))).rejects.toMatchObject(
        { reason: 'upstream_failure' },
      );
      await expect(replicaB.execute('captcha', async () => Promise.resolve(undefined))).rejects.toMatchObject({
        reason: 'circuit_open',
      });
      await expect(replicaB.getDistributedStatus()).resolves.toMatchObject({ state: 'open' });

      jest.advanceTimersByTime(1000);
      await expect(replicaA.execute('captcha', async () => Promise.resolve(undefined))).resolves.toBeUndefined();
      await expect(replicaB.getDistributedStatus()).resolves.toMatchObject({ state: 'available' });
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects work above the process-local concurrency bulkhead', async () => {
    const service = createService(createSharedRedis(), { UNIVERSITY_EXTERNAL_MAX_CONCURRENT_REQUESTS: '1' });
    let release!: () => void;
    const pending = service.execute('captcha', () => new Promise<void>((resolve) => (release = resolve)));
    await new Promise<void>((resolve) => setImmediate(resolve));

    await expect(service.execute('captcha', () => Promise.resolve(undefined))).rejects.toMatchObject({
      reason: 'overloaded',
    });
    release();
    await pending;
  });

  it('allows only one distributed half-open probe after the reset interval', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const values = {
        UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD: '1',
        UNIVERSITY_EXTERNAL_CIRCUIT_RESET_MS: '1000',
      };
      const replicaA = createService(redis, values);
      const replicaB = createService(redis, values);
      await expect(replicaA.execute('captcha', () => Promise.reject(new Error('offline')))).rejects.toBeDefined();
      jest.advanceTimersByTime(1000);

      let release!: () => void;
      const probe = replicaA.execute('captcha', () => new Promise<void>((resolve) => (release = resolve)));
      await Promise.resolve();
      await Promise.resolve();
      await expect(replicaB.execute('captcha', () => Promise.resolve())).rejects.toMatchObject({
        reason: 'circuit_open',
      });
      release();
      await probe;
    } finally {
      jest.useRealTimers();
    }
  });

  it('fails closed when the shared circuit state cannot be read', async () => {
    const redis = createSharedRedis();
    redis.get.mockRejectedValue(new Error('redis unavailable'));
    const service = createService(redis);

    await expect(service.execute('captcha', () => Promise.resolve())).rejects.toMatchObject({
      reason: 'state_unavailable',
    });
  });
});
