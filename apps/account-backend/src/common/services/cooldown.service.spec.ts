import type { RedisService } from '../../redis/redis.service';
import { CooldownService } from './cooldown.service';

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
  const redis = {
    get: jest.fn((key: string) => Promise.resolve(read(key))),
    ttl: jest.fn((key: string) => {
      const entry = values.get(key);
      if (!entry) return Promise.resolve(-2);
      if (entry.expiresAt === undefined) return Promise.resolve(-1);
      if (entry.expiresAt <= Date.now()) {
        values.delete(key);
        return Promise.resolve(-2);
      }
      return Promise.resolve(Math.ceil((entry.expiresAt - Date.now()) / 1000));
    }),
    del: jest.fn((key: string) => Promise.resolve(values.delete(key) ? 1 : 0)),
    eval: jest.fn((_script: string, keys: string[]) => {
      const [attemptsKey, stateKey] = keys;
      const currentAttempts = Number(read(attemptsKey) ?? 0);
      const attempts = currentAttempts + 1;
      if (currentAttempts === 0) {
        values.set(attemptsKey, { value: String(attempts), expiresAt: Date.now() + 10 * 60 * 1000 });
      } else {
        const current = values.get(attemptsKey);
        values.set(attemptsKey, { value: String(attempts), expiresAt: current?.expiresAt });
      }
      const effectiveAttempts = Math.min(attempts, 30);
      const cooldownSeconds = Math.pow(2, effectiveAttempts);
      values.set(stateKey, { value: String(effectiveAttempts), expiresAt: Date.now() + cooldownSeconds * 1000 });
      return Promise.resolve([effectiveAttempts, cooldownSeconds]);
    }),
  };
  return redis as unknown as RedisService;
};

describe('CooldownService', () => {
  it('shares cooldown attempts and clearing across replicas', async () => {
    const redis = createSharedRedis();
    const replicaA = new CooldownService(redis);
    const replicaB = new CooldownService(redis);

    await replicaA.setCooldown('user-1', 'updateRoles');
    await expect(replicaB.isOnCooldown('user-1', 'updateRoles')).resolves.toBe(true);
    await expect(replicaB.getAttempts('user-1', 'updateRoles')).resolves.toBe(1);
    await replicaB.setCooldown('user-1', 'updateRoles');
    await expect(replicaA.getAttempts('user-1', 'updateRoles')).resolves.toBe(2);
    await replicaA.clearCooldown('user-1', 'updateRoles');
    await expect(replicaB.isOnCooldown('user-1', 'updateRoles')).resolves.toBe(false);
  });

  it('expires cooldown state and survives a service restart with only the bounded attempt window', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const serviceA = new CooldownService(redis);
      await serviceA.setCooldown('user-1', 'updateRoles');
      jest.advanceTimersByTime(2001);

      const restartedService = new CooldownService(redis);
      await expect(restartedService.isOnCooldown('user-1', 'updateRoles')).resolves.toBe(false);
      await expect(restartedService.getAttempts('user-1', 'updateRoles')).resolves.toBe(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
