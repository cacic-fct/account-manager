import type { Response } from 'express';
import type { AuthSession } from '../auth/auth.controller';
import { TotpController } from './totp.controller';
import { TotpService } from './totp.service';

const session = (authenticatedAt?: number): AuthSession => ({
  user: {
    keycloakId: '00000000-0000-4000-8000-000000000001',
    email: 'user@example.test',
    isOnboarded: true,
  },
  authenticatedAt,
  destroy: jest.fn(),
});

describe(TotpController.name, () => {
  const totp = {
    getOrCreateSeed: jest.fn().mockResolvedValue({ seed: 'SECRET' }),
    rotateSeed: jest.fn().mockResolvedValue({ seed: 'ROTATED' }),
  };
  const controller = new TotpController(totp as unknown as TotpService);
  const setHeader = jest.fn();
  const response = { setHeader } as unknown as Response;

  beforeEach(() => jest.clearAllMocks());

  it.each([undefined, Date.now() - 6 * 60_000])(
    'reveals a seed without a recent login (%s)',
    async (authenticatedAt) => {
      await expect(controller.getOrCreateSeed(session(authenticatedAt), response)).resolves.toEqual({ seed: 'SECRET' });
      expect(totp.getOrCreateSeed).toHaveBeenCalledWith({
        keycloakId: '00000000-0000-4000-8000-000000000001',
        primaryEmail: 'user@example.test',
      });
    },
  );

  it('marks recently authorized seed responses as private and non-cacheable', async () => {
    await controller.getOrCreateSeed(session(Date.now()), response);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(totp.getOrCreateSeed).toHaveBeenCalledTimes(1);
  });

  it('requires an explicit rotation login even when the regular login was recent', async () => {
    await expect(controller.rotateSeed(session(Date.now()), response)).rejects.toMatchObject({
      response: { code: 'TOTP_ROTATION_LOGIN_REQUIRED' },
    });
    expect(totp.rotateSeed).not.toHaveBeenCalled();
  });

  it('rejects an expired rotation login', async () => {
    const currentSession = session(Date.now());
    currentSession.totpRotationAuthenticatedAt = Date.now() - 6 * 60_000;

    await expect(controller.rotateSeed(currentSession, response)).rejects.toMatchObject({
      response: { code: 'TOTP_ROTATION_LOGIN_REQUIRED' },
    });
    expect(totp.rotateSeed).not.toHaveBeenCalled();
  });

  it('consumes the rotation login before rotating and prevents caching the new seed', async () => {
    const currentSession = session(Date.now());
    currentSession.totpRotationAuthenticatedAt = Date.now();
    currentSession.save = jest.fn((callback) => callback());

    await expect(controller.rotateSeed(currentSession, response)).resolves.toEqual({ seed: 'ROTATED' });

    expect(currentSession.totpRotationAuthenticatedAt).toBeUndefined();
    expect(currentSession.save).toHaveBeenCalledTimes(1);
    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    await expect(controller.rotateSeed(currentSession, response)).rejects.toMatchObject({ status: 403 });
    expect(totp.rotateSeed).toHaveBeenCalledTimes(1);
  });

  it('does not rotate if the consumed authorization cannot be saved', async () => {
    const currentSession = session(Date.now());
    currentSession.totpRotationAuthenticatedAt = Date.now();
    currentSession.save = jest.fn((callback) => callback(new Error('Session store unavailable')));

    await expect(controller.rotateSeed(currentSession, response)).rejects.toThrow('Session store unavailable');
    expect(totp.rotateSeed).not.toHaveBeenCalled();
  });
});
