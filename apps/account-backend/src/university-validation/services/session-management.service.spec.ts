import { ConfigService } from '@nestjs/config';
import { CookieJar } from 'tough-cookie';
import { SessionManagementService } from './session-management.service';

const createService = (values: Record<string, string> = {}) =>
  new SessionManagementService({ get: (name: string) => values[name] } as ConfigService);

describe('SessionManagementService', () => {
  it('enforces ownership and evicts the oldest session at capacity', () => {
    const service = createService({ UNIVERSITY_EXTERNAL_MAX_SESSIONS: '1' });
    service.storeSession({ sessionId: 'first', userId: 'user-1', cookieJar: new CookieJar(), createdAt: new Date() });
    service.storeSession({ sessionId: 'second', userId: 'user-2', cookieJar: new CookieJar(), createdAt: new Date() });

    expect(service.getSession('first')).toBeUndefined();
    expect(service.getOwnedSession('second', 'user-1')).toBeUndefined();
    expect(service.getOwnedSession('second', 'user-2')?.sessionId).toBe('second');
  });

  it('expires sessions on read', () => {
    const service = createService({ UNIVERSITY_EXTERNAL_SESSION_TTL_MS: '1000' });
    service.storeSession({
      sessionId: 'expired',
      userId: 'user-1',
      cookieJar: new CookieJar(),
      createdAt: new Date(Date.now() - 1001),
    });
    expect(service.getSession('expired')).toBeUndefined();
  });
});
