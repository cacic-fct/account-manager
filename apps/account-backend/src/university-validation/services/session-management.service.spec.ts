import { ConfigService } from '@nestjs/config';
import { CookieJar } from 'tough-cookie';
import type { RedisService } from '../../redis/redis.service';
import { SessionManagementService } from './session-management.service';

interface RedisValue {
  value: string;
  expiresAt?: number;
}

const createSharedRedis = () => {
  const values = new Map<string, RedisValue>();
  const redis = {
    get: jest.fn((key: string) => {
      const entry = values.get(key);
      if (entry?.expiresAt !== undefined && entry.expiresAt <= Date.now()) {
        values.delete(key);
        return Promise.resolve(null);
      }
      return Promise.resolve(entry?.value ?? null);
    }),
    set: jest.fn((key: string, value: string, ttl?: number) => {
      values.set(key, { value, expiresAt: ttl === undefined ? undefined : Date.now() + ttl * 1000 });
      return Promise.resolve();
    }),
    del: jest.fn((key: string) => Promise.resolve(values.delete(key) ? 1 : 0)),
  };
  return redis as unknown as RedisService;
};

const createConfig = (values: Record<string, string> = {}) =>
  ({ get: (name: string) => values[name] }) as ConfigService;

const createSession = (sessionId: string, userId: string) => ({
  sessionId,
  userId,
  cookieJar: new CookieJar(),
  authCode: 'AAAA-BBBB',
  enrollmentNumber: '123',
  hiddenInputs: { token: 'opaque' },
  pageUrl: 'https://sistemas.unesp.br/academico/publico/documento.action',
  formActionUrl: 'https://sistemas.unesp.br/academico/publico/documento.emitir.action',
  createdAt: new Date(),
});

describe('SessionManagementService', () => {
  it('enforces ownership and evicts the oldest local session at capacity', async () => {
    const redis = createSharedRedis();
    const service = new SessionManagementService(createConfig({ UNIVERSITY_EXTERNAL_MAX_SESSIONS: '1' }), redis);
    await service.storeSession(createSession('first', 'user-1'));
    await service.storeSession(createSession('second', 'user-2'));

    await expect(service.getSession('first')).resolves.toBeUndefined();
    await expect(service.getOwnedSession('second', 'user-1')).resolves.toBeUndefined();
    await expect(service.getOwnedSession('second', 'user-2')).resolves.toMatchObject({ sessionId: 'second' });
  });

  it('shares a session and its cookies across replicas and a simulated restart', async () => {
    const redis = createSharedRedis();
    const serviceA = new SessionManagementService(createConfig(), redis);
    const serviceB = new SessionManagementService(createConfig(), redis);
    const session = createSession('shared', 'user-1');
    await session.cookieJar.setCookie('JSESSIONID=opaque; Path=/academico; Secure', 'https://sistemas.unesp.br');

    await serviceA.storeSession(session);
    const fromReplicaB = await serviceB.getOwnedSession('shared', 'user-1');
    const restartedReplicaA = new SessionManagementService(createConfig(), redis);
    const afterRestart = await restartedReplicaA.getOwnedSession('shared', 'user-1');

    expect(fromReplicaB?.authCode).toBe('AAAA-BBBB');
    await expect(
      fromReplicaB?.cookieJar.getCookieString('https://sistemas.unesp.br/academico/documento.action'),
    ).resolves.toContain('JSESSIONID=opaque');
    expect(afterRestart?.enrollmentNumber).toBe('123');
  });

  it('preserves live sessions when a replica at capacity reads a session from another replica', async () => {
    const redis = createSharedRedis();
    const config = createConfig({ UNIVERSITY_EXTERNAL_MAX_SESSIONS: '1' });
    const serviceA = new SessionManagementService(config, redis);
    const serviceB = new SessionManagementService(config, redis);
    await serviceA.storeSession(createSession('first', 'user-1'));
    await serviceB.storeSession(createSession('second', 'user-2'));

    await expect(serviceA.getOwnedSession('second', 'user-2')).resolves.toMatchObject({ sessionId: 'second' });
    await expect(serviceB.getOwnedSession('first', 'user-1')).resolves.toMatchObject({ sessionId: 'first' });
    await serviceA.storeSession(createSession('third', 'user-3'));

    await expect(serviceB.getSession('first')).resolves.toBeUndefined();
    await expect(serviceB.getOwnedSession('second', 'user-2')).resolves.toMatchObject({ sessionId: 'second' });
  });

  it('expires sessions from Redis after the configured TTL', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const service = new SessionManagementService(createConfig({ UNIVERSITY_EXTERNAL_SESSION_TTL_MS: '1000' }), redis);
      await service.storeSession(createSession('expiring', 'user-1'));

      jest.advanceTimersByTime(1001);
      await expect(service.getSession('expiring')).resolves.toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('keeps only timestamps locally and prunes metadata without a timer', async () => {
    jest.useFakeTimers();
    try {
      const redis = createSharedRedis();
      const service = new SessionManagementService(createConfig({ UNIVERSITY_EXTERNAL_SESSION_TTL_MS: '1000' }), redis);
      const session = createSession('expired', 'user-1');
      await service.storeSession(session);
      // Mutating the request's object must not mutate a retained process-local copy.
      session.authCode = 'changed';
      await expect(service.getSession('expired')).resolves.toMatchObject({ authCode: 'AAAA-BBBB' });
      jest.advanceTimersByTime(1001);
      await service.storeSession(createSession('new', 'user-2'));
      await expect(service.getSession('expired')).resolves.toBeUndefined();
      await expect(service.getSession('new')).resolves.toMatchObject({ sessionId: 'new' });
    } finally {
      jest.useRealTimers();
    }
  });
});
