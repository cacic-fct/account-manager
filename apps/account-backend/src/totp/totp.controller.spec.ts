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

  it('requires recent authentication before revealing a seed', () => {
    expect(() => controller.getOrCreateSeed(session(Date.now() - 6 * 60_000), response)).toThrow(
      'Recent authentication is required',
    );
    expect(totp.getOrCreateSeed).not.toHaveBeenCalled();
  });

  it('marks recently authorized seed responses as private and non-cacheable', async () => {
    await controller.getOrCreateSeed(session(Date.now()), response);

    expect(setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store, private');
    expect(setHeader).toHaveBeenCalledWith('Pragma', 'no-cache');
    expect(totp.getOrCreateSeed).toHaveBeenCalledTimes(1);
  });
});
