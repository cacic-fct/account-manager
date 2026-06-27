import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import type { User } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UserService } from '../auth/services/user.service';
import {
  TOTP_ALGORITHM,
  TOTP_DIGITS,
  TOTP_PERIOD_SECONDS,
  TOTP_SECRET_BYTES,
  TOTP_VALIDATION_WINDOW_STEPS,
} from './totp.constants';

export interface TotpSeedResult {
  userId: string;
  primaryEmail: string;
  seed: string;
  algorithm: typeof TOTP_ALGORITHM;
  digits: typeof TOTP_DIGITS;
  periodSeconds: typeof TOTP_PERIOD_SECONDS;
  serverTime: Date;
}

export interface TotpStatusResult {
  configured: boolean;
  algorithm: typeof TOTP_ALGORITHM;
  digits: typeof TOTP_DIGITS;
  periodSeconds: typeof TOTP_PERIOD_SECONDS;
  serverTime: Date;
  createdAt?: Date;
  rotatedAt?: Date;
}

export interface TotpValidationResult {
  valid: boolean;
  serverTime: Date;
  userId?: string;
  primaryEmail?: string;
  matchedStepOffset?: -1 | 0 | 1;
}

export interface EnsureUserInput {
  keycloakId: string;
  primaryEmail: string;
  displayName?: string | null;
}

interface EncryptedSeed {
  totpSecretEncrypted: string;
  totpSecretIv: string;
  totpSecretAuthTag: string;
}

@Injectable()
export class TotpService {
  private readonly logger = new Logger(TotpService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly userService: UserService,
  ) {}

  async getStatus(userId: string): Promise<TotpStatusResult> {
    const user = await this.prisma.user.findUnique({
      where: { keycloakId: userId },
      select: {
        totpSecretEncrypted: true,
        totpSecretCreatedAt: true,
        totpSecretRotatedAt: true,
      },
    });

    return {
      configured: Boolean(user?.totpSecretEncrypted),
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      periodSeconds: TOTP_PERIOD_SECONDS,
      serverTime: new Date(),
      ...(user?.totpSecretCreatedAt
        ? { createdAt: user.totpSecretCreatedAt }
        : {}),
      ...(user?.totpSecretRotatedAt
        ? { rotatedAt: user.totpSecretRotatedAt }
        : {}),
    };
  }

  async getOrCreateSeed(input: EnsureUserInput): Promise<TotpSeedResult> {
    const user = await this.ensureUser(input);
    if (this.hasEncryptedSeed(user)) {
      return this.toSeedResult(user, this.decryptSeed(user));
    }

    const seed = this.generateSeed();
    const encryptedSeed = this.encryptSeed(seed);
    const updatedUser = await this.prisma.user.update({
      where: { keycloakId: input.keycloakId },
      data: {
        ...encryptedSeed,
        totpSecretCreatedAt: new Date(),
        totpSecretRotatedAt: null,
      },
    });

    return this.toSeedResult(updatedUser, seed);
  }

  async rotateSeed(input: EnsureUserInput): Promise<TotpSeedResult> {
    await this.ensureUser(input);
    const seed = this.generateSeed();
    const encryptedSeed = this.encryptSeed(seed);
    const updatedUser = await this.prisma.user.update({
      where: { keycloakId: input.keycloakId },
      data: {
        ...encryptedSeed,
        totpSecretCreatedAt: new Date(),
        totpSecretRotatedAt: new Date(),
      },
    });

    return this.toSeedResult(updatedUser, seed);
  }

  async disableSeed(userId: string): Promise<TotpStatusResult> {
    await this.prisma.user.updateMany({
      where: { keycloakId: userId },
      data: {
        totpSecretEncrypted: null,
        totpSecretIv: null,
        totpSecretAuthTag: null,
        totpSecretCreatedAt: null,
        totpSecretRotatedAt: null,
      },
    });

    return this.getStatus(userId);
  }

  async relaySeed(userId: string): Promise<TotpSeedResult> {
    const profile = await this.userService.findByKeycloakId(userId);
    if (!profile) {
      throw new NotFoundException('User not found');
    }

    return this.getOrCreateSeed({
      keycloakId: profile.keycloakId,
      primaryEmail: profile.email,
      displayName: profile.displayName || profile.fullname || null,
    });
  }

  async validateCode(
    primaryEmail: string,
    rawCode: string,
  ): Promise<TotpValidationResult> {
    const normalizedEmail = this.normalizeEmail(primaryEmail);
    const code = this.normalizeCode(rawCode);
    const serverTime = new Date();

    if (!code) {
      return { valid: false, serverTime };
    }

    const user = await this.prisma.user.findUnique({
      where: { primaryEmailNormalized: normalizedEmail },
    });

    if (!user || !this.hasEncryptedSeed(user)) {
      return { valid: false, serverTime };
    }

    const seed = this.decryptSeed(user);
    const now = Date.now();

    for (
      let offset = -TOTP_VALIDATION_WINDOW_STEPS;
      offset <= TOTP_VALIDATION_WINDOW_STEPS;
      offset += 1
    ) {
      const timestamp = now + offset * TOTP_PERIOD_SECONDS * 1000;
      const expectedCode = this.generateCode(seed, timestamp);
      if (this.safeCodeEquals(code, expectedCode)) {
        return {
          valid: true,
          serverTime,
          userId: user.keycloakId,
          primaryEmail: user.primaryEmail,
          matchedStepOffset: offset as -1 | 0 | 1,
        };
      }
    }

    return { valid: false, serverTime };
  }

  generateCode(seed: string, timestamp = Date.now()): string {
    const counter = Math.floor(timestamp / 1000 / TOTP_PERIOD_SECONDS);
    const hmac = createHmac('sha512', this.decodeBase32(seed));
    hmac.update(this.counterToBuffer(counter));
    const digest = hmac.digest();
    const offset = digest[digest.length - 1] & 0x0f;
    const binary =
      ((digest[offset] & 0x7f) << 24) |
      ((digest[offset + 1] & 0xff) << 16) |
      ((digest[offset + 2] & 0xff) << 8) |
      (digest[offset + 3] & 0xff);
    const code = binary % 10 ** TOTP_DIGITS;

    return code.toString().padStart(TOTP_DIGITS, '0');
  }

  normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async ensureUser(input: EnsureUserInput): Promise<User> {
    const primaryEmail = input.primaryEmail.trim();
    if (!primaryEmail) {
      throw new ConflictException('User primary email is required');
    }

    return this.prisma.user.upsert({
      where: { keycloakId: input.keycloakId },
      create: {
        keycloakId: input.keycloakId,
        primaryEmail,
        primaryEmailNormalized: this.normalizeEmail(primaryEmail),
        displayName: input.displayName ?? null,
      },
      update: {
        primaryEmail,
        primaryEmailNormalized: this.normalizeEmail(primaryEmail),
        displayName: input.displayName ?? null,
      },
    });
  }

  private hasEncryptedSeed(
    user: Pick<
      User,
      'totpSecretEncrypted' | 'totpSecretIv' | 'totpSecretAuthTag'
    >,
  ): user is User & Required<EncryptedSeed> {
    return Boolean(
      user.totpSecretEncrypted && user.totpSecretIv && user.totpSecretAuthTag,
    );
  }

  private toSeedResult(user: User, seed: string): TotpSeedResult {
    return {
      userId: user.keycloakId,
      primaryEmail: user.primaryEmail,
      seed,
      algorithm: TOTP_ALGORITHM,
      digits: TOTP_DIGITS,
      periodSeconds: TOTP_PERIOD_SECONDS,
      serverTime: new Date(),
    };
  }

  private generateSeed(): string {
    return this.encodeBase32(randomBytes(TOTP_SECRET_BYTES));
  }

  private encryptSeed(seed: string): EncryptedSeed {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey(), iv);
    const encrypted = Buffer.concat([
      cipher.update(seed, 'utf8'),
      cipher.final(),
    ]);
    const authTag = cipher.getAuthTag();

    return {
      totpSecretEncrypted: encrypted.toString('base64'),
      totpSecretIv: iv.toString('base64'),
      totpSecretAuthTag: authTag.toString('base64'),
    };
  }

  private decryptSeed(user: Required<EncryptedSeed>): string {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey(),
      Buffer.from(user.totpSecretIv, 'base64'),
    );
    decipher.setAuthTag(Buffer.from(user.totpSecretAuthTag, 'base64'));

    return Buffer.concat([
      decipher.update(Buffer.from(user.totpSecretEncrypted, 'base64')),
      decipher.final(),
    ]).toString('utf8');
  }

  private encryptionKey(): Buffer {
    const secret =
      this.configService.get<string>('TOTP_SECRET_ENCRYPTION_KEY') ??
      this.configService.get<string>('SESSION_SECRET');

    if (!secret) {
      this.logger.error(
        'TOTP_SECRET_ENCRYPTION_KEY or SESSION_SECRET is required',
      );
      throw new Error('TOTP encryption key is not configured');
    }

    return createHash('sha256').update(secret).digest();
  }

  private encodeBase32(buffer: Buffer): string {
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
  }

  private decodeBase32(value: string): Buffer {
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
    const bytes: number[] = [];
    let bits = 0;
    let bitCount = 0;

    for (const character of normalized) {
      const index = alphabet.indexOf(character);
      if (index === -1) {
        throw new Error('Invalid TOTP seed');
      }

      bits = (bits << 5) | index;
      bitCount += 5;

      if (bitCount >= 8) {
        bytes.push((bits >>> (bitCount - 8)) & 0xff);
        bitCount -= 8;
      }
    }

    return Buffer.from(bytes);
  }

  private counterToBuffer(counter: number): Buffer {
    const buffer = Buffer.alloc(8);
    const high = Math.floor(counter / 0x100000000);
    const low = counter >>> 0;

    buffer.writeUInt32BE(high, 0);
    buffer.writeUInt32BE(low, 4);

    return buffer;
  }

  private normalizeCode(code: string): string | null {
    const normalized = code.replace(/\D/g, '');
    return /^\d{6}$/.test(normalized) ? normalized : null;
  }

  private safeCodeEquals(a: string, b: string): boolean {
    const bufferA = Buffer.from(a);
    const bufferB = Buffer.from(b);

    return (
      bufferA.length === bufferB.length && timingSafeEqual(bufferA, bufferB)
    );
  }
}
