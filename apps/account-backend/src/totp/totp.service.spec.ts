import { ConfigService } from '@nestjs/config';
import { TotpService } from './totp.service';

const encodeBase32 = (buffer: Buffer): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let bitCount = 0;
  let output = '';

  for (const byte of buffer) {
    bits = (bits << 8) | byte;
    bitCount += 8;

    while (bitCount >= 5) {
      output += alphabet[(bits >>> (bitCount - 5)) & 31];
      bitCount -= 5;
    }
  }

  if (bitCount > 0) {
    output += alphabet[(bits << (5 - bitCount)) & 31];
  }

  return output;
};

describe(TotpService.name, () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const configService = {
    get: jest.fn((key: string) => (key === 'SESSION_SECRET' ? 'test-session-secret' : undefined)),
  };
  const userService = {
    findByKeycloakId: jest.fn(),
  };
  const redis = {
    incrementWithExpiry: jest.fn().mockResolvedValue(1),
    setIfAbsent: jest.fn().mockResolvedValue(true),
  };

  let service: TotpService;

  beforeEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
    service = new TotpService(
      prisma as never,
      configService as unknown as ConfigService,
      userService as never,
      redis as never,
    );
  });

  it('generates six digit HMAC-SHA-512 codes using the RFC 6238 counter', () => {
    const sha512VectorSecret = encodeBase32(
      Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
    );

    expect(service.generateCode(sha512VectorSecret, 59_000)).toBe('693936');
  });

  it('validates the previous, current, and next 30 second steps', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-26T16:00:00.000Z'));
    const seed = encodeBase32(Buffer.from('offline-user-test-seed-value'));
    const encrypted = (
      service as unknown as {
        encryptSeed(seed: string): {
          totpSecretEncrypted: string;
          totpSecretIv: string;
          totpSecretAuthTag: string;
        };
      }
    ).encryptSeed(seed);

    prisma.user.findUnique.mockResolvedValue({
      keycloakId: 'user-1',
      primaryEmail: 'User@One.Example',
      ...encrypted,
    });

    for (const offset of [-1, 0, 1] as const) {
      const code = service.generateCode(seed, Date.now() + offset * 30_000);
      const result = await service.validateCode('user@one.example', code);

      expect(result).toMatchObject({
        valid: true,
        userId: 'user-1',
        primaryEmail: 'User@One.Example',
        matchedStepOffset: offset,
      });
    }
  });

  it('does not disclose user existence when validation fails', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const result = await service.validateCode('missing@example.com', '123 456');

    expect(result.valid).toBe(false);
    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('primaryEmail');
  });

  it('rejects reuse of an already consumed TOTP time step', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-26T16:00:00.000Z'));
    const seed = encodeBase32(Buffer.from('offline-user-test-seed-value'));
    const encrypted = (
      service as unknown as {
        encryptSeed(seed: string): {
          totpSecretEncrypted: string;
          totpSecretIv: string;
          totpSecretAuthTag: string;
        };
      }
    ).encryptSeed(seed);
    prisma.user.findUnique.mockResolvedValue({
      keycloakId: 'user-1',
      primaryEmail: 'user@example.com',
      ...encrypted,
    });
    redis.setIfAbsent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const code = service.generateCode(seed);

    await expect(service.validateCode('user@example.com', code, 'client-a')).resolves.toMatchObject({ valid: true });
    await expect(service.validateCode('user@example.com', code, 'client-b')).resolves.toEqual(
      expect.objectContaining({ valid: false }),
    );
  });

  it('returns the persisted seed when concurrent enrollment loses the conditional claim', async () => {
    const seed = encodeBase32(Buffer.from('persisted-user-test-seed-value'));
    const encrypted = (
      service as unknown as {
        encryptSeed(seed: string): {
          totpSecretEncrypted: string;
          totpSecretIv: string;
          totpSecretAuthTag: string;
        };
      }
    ).encryptSeed(seed);
    prisma.user.upsert.mockResolvedValue({
      keycloakId: 'user-1',
      primaryEmail: 'user@example.com',
      totpSecretEncrypted: null,
      totpSecretIv: null,
      totpSecretAuthTag: null,
    });
    prisma.user.updateMany.mockResolvedValue({ count: 0 });
    prisma.user.findUnique.mockResolvedValue({
      keycloakId: 'user-1',
      primaryEmail: 'user@example.com',
      ...encrypted,
    });

    await expect(
      service.getOrCreateSeed({ keycloakId: 'user-1', primaryEmail: 'user@example.com' }),
    ).resolves.toMatchObject({ seed });
  });
});
