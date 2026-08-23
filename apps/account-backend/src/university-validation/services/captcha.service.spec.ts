import type { S3Service } from '../../common/services/s3.service';
import type { RedisService } from '../../redis/redis.service';
import { CaptchaService } from './captcha.service';

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
      const [attemptsKey, cooldownKey] = keys;
      const currentAttempts = Number(read(attemptsKey) ?? 0);
      const attempts = currentAttempts + 1;
      const existing = values.get(attemptsKey);
      values.set(attemptsKey, {
        value: String(attempts),
        expiresAt: existing?.expiresAt ?? Date.now() + 10 * 60 * 1000,
      });
      const cooldownSeconds = attempts * attempts;
      values.set(cooldownKey, { value: String(attempts), expiresAt: Date.now() + cooldownSeconds * 1000 });
      return Promise.resolve([attempts, cooldownSeconds]);
    }),
  };
  return redis as unknown as RedisService;
};

describe('CaptchaService', () => {
  it('shares cooldown state across replicas and clears it after success', async () => {
    const redis = createSharedRedis();
    const replicaA = new CaptchaService({} as S3Service, redis);
    const replicaB = new CaptchaService({} as S3Service, redis);

    await replicaA.recordCaptchaRequest('user-1');
    await expect(replicaB.isUserInCooldown('user-1')).resolves.toMatchObject({
      inCooldown: true,
      remainingSeconds: 1,
    });
    await expect(replicaB.getCooldownStatus('user-1')).resolves.toMatchObject({ attempts: 1 });
    await replicaB.recordFailedAttempt('user-1');
    await expect(replicaA.getCooldownStatus('user-1')).resolves.toMatchObject({ attempts: 2 });

    await replicaA.recordSuccessfulAttempt('user-1');
    await expect(replicaB.isUserInCooldown('user-1')).resolves.toMatchObject({
      inCooldown: false,
      remainingSeconds: 0,
    });
  });

  it('expires cooldown after restart while retaining only the bounded attempt window', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const serviceA = new CaptchaService({} as S3Service, redis);
      await serviceA.recordCaptchaRequest('user-1');
      jest.advanceTimersByTime(1001);

      const restartedService = new CaptchaService({} as S3Service, redis);
      await expect(restartedService.isUserInCooldown('user-1')).resolves.toMatchObject({
        inCooldown: false,
        remainingSeconds: 0,
      });
      await expect(restartedService.getCooldownStatus('user-1')).resolves.toMatchObject({ attempts: 1 });
    } finally {
      jest.useRealTimers();
    }
  });
});
