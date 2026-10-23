import { Logger } from '@nestjs/common';
import { KeycloakService } from '../keycloak.service';

class TestKeycloakService extends KeycloakService {
  readonly request = jest.fn<Promise<Response>, [string, RequestInit?]>();

  override getAdminToken(): Promise<string> {
    return Promise.resolve('admin-token');
  }

  protected override fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
    return this.request(url, options);
  }
}

describe('Keycloak user update notifications', () => {
  afterEach(() => jest.restoreAllMocks());

  const createService = () => {
    const service = new TestKeycloakService();
    service.request
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 'user-1', attributes: {} })))
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    return service;
  };

  it('awaits synchronization after saving verification attributes', async () => {
    const service = createService();
    const listener = jest.fn<Promise<void>, [string]>().mockImplementation(() => {
      expect(service.request).toHaveBeenCalledTimes(2);
      return Promise.resolve();
    });
    service.onUserUpdated(listener);

    await service.updateUserAttributes('user-1', { unespRoleVerified: ['false'] }, { skipValidation: true });

    expect(listener).toHaveBeenCalledWith('user-1');
  });

  it('notifies after general account updates', async () => {
    const service = createService();
    const listener = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    service.onUserUpdated(listener);

    await service.updateUser('user-1', { email: 'student@example.test' });

    expect(listener).toHaveBeenCalledWith('user-1');
  });

  it('notifies after deleting an account', async () => {
    const service = new TestKeycloakService();
    service.request.mockResolvedValue(new Response(null, { status: 204 }));
    const listener = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    service.onUserUpdated(listener);

    await service.deleteUser('user-1');

    expect(listener).toHaveBeenCalledWith('user-1');
  });

  it('does not notify after a failed identity mutation', async () => {
    const service = createService();
    service.request
      .mockReset()
      .mockResolvedValueOnce(new Response(JSON.stringify({ attributes: {} })))
      .mockResolvedValueOnce(new Response('failure', { status: 500 }));
    const listener = jest.fn();
    service.onUserUpdated(listener);

    await expect(service.updateUser('user-1', { email: 'student@example.test' })).rejects.toThrow();
    expect(listener).not.toHaveBeenCalled();
  });

  it('isolates synchronization failures from successful identity writes', async () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const service = createService();
    service.onUserUpdated(() => Promise.reject(new Error('Discord unavailable')));
    const nextListener = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    service.onUserUpdated(nextListener);

    await expect(service.updateUser('user-1', { email: 'student@example.test' })).resolves.toBeUndefined();
    expect(nextListener).toHaveBeenCalledWith('user-1');
  });

  it('unsubscribes consumers on shutdown', async () => {
    const service = createService();
    const listener = jest.fn<Promise<void>, [string]>().mockResolvedValue();
    const unsubscribe = service.onUserUpdated(listener);
    unsubscribe();

    await service.updateUser('user-1', { email: 'student@example.test' });

    expect(listener).not.toHaveBeenCalled();
  });
});
