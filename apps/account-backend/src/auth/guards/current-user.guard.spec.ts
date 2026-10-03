import { ExecutionContext, ForbiddenException, Logger, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { KeycloakConnectionException } from '../exceptions/keycloak-connection.exception';
import { KeycloakService } from '../services/keycloak.service';
import { KeycloakUserData } from '../services/keycloak/keycloak.types';
import { CurrentUserGuard } from './current-user.guard';

describe(CurrentUserGuard.name, () => {
  const getUserBasicInfo = jest.fn<Promise<KeycloakUserData | null>, [string]>();
  const reflector = { getAllAndOverride: jest.fn() };
  const context = {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => ({ session: { user: { keycloakId: 'session-user' } } }),
    }),
  } as unknown as ExecutionContext;
  let guard: CurrentUserGuard;

  beforeEach(() => {
    jest.resetAllMocks();
    guard = new CurrentUserGuard({ getUserBasicInfo } as unknown as KeycloakService, reflector as unknown as Reflector);
  });

  afterEach(() => jest.restoreAllMocks());

  it('checks the session user and permits an enabled account', async () => {
    getUserBasicInfo.mockResolvedValue({ id: 'session-user', email: 'user@example.test', enabled: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getUserBasicInfo).toHaveBeenCalledWith('session-user');
  });

  it('rejects an explicitly disabled Keycloak account', async () => {
    getUserBasicInfo.mockResolvedValue({ id: 'session-user', email: 'user@example.test', enabled: false });

    await expect(guard.canActivate(context)).rejects.toThrow(new ForbiddenException('Session user is disabled'));
  });

  it('rejects a session whose account no longer exists', async () => {
    getUserBasicInfo.mockResolvedValue(null);

    await expect(guard.canActivate(context)).rejects.toThrow(
      new UnauthorizedException('Session user no longer exists'),
    );
  });

  it('preserves service unavailability when Keycloak cannot be reached', async () => {
    const outage = new KeycloakConnectionException('Unable to connect to authentication service');
    getUserBasicInfo.mockRejectedValue(outage);

    await expect(guard.canActivate(context)).rejects.toBe(outage);
    expect(outage.getStatus()).toBe(503);
  });

  it('fails closed for an unexpected validation error', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    getUserBasicInfo.mockRejectedValue(new Error('Invalid user response'));

    await expect(guard.canActivate(context)).rejects.toThrow(new ForbiddenException('Unable to validate current user'));
  });
});
