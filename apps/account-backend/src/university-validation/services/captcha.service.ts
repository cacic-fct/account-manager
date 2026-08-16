import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service } from '../../common/services/s3.service';

interface UserCooldown {
  attempts: number;
  lastAttemptTime: number;
  cooldownUntil: number;
}

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly userCooldowns = new Map<string, UserCooldown>();
  private readonly resetThresholdMs = 10 * 60 * 1000;
  private readonly maxCooldownEntries = 10_000;

  constructor(private readonly s3Service: S3Service) {}

  isUserInCooldown(userId: string): {
    inCooldown: boolean;
    remainingSeconds: number;
  } {
    const cooldown = this.userCooldowns.get(userId);
    if (!cooldown || Date.now() >= cooldown.cooldownUntil) {
      return { inCooldown: false, remainingSeconds: 0 };
    }

    return {
      inCooldown: true,
      remainingSeconds: Math.ceil((cooldown.cooldownUntil - Date.now()) / 1000),
    };
  }

  recordFailedAttempt(userId: string): { cooldownSeconds: number } {
    return this.recordAttempt(userId);
  }

  recordCaptchaRequest(userId: string): { cooldownSeconds: number } {
    return this.recordAttempt(userId);
  }

  recordSuccessfulAttempt(userId: string): void {
    this.userCooldowns.delete(userId);
  }

  getCooldownStatus(userId: string): {
    inCooldown: boolean;
    remainingSeconds: number;
    attempts: number;
    nextCooldownSeconds: number;
  } {
    const cooldownCheck = this.isUserInCooldown(userId);
    const attempts = this.userCooldowns.get(userId)?.attempts ?? 0;
    return {
      ...cooldownCheck,
      attempts,
      nextCooldownSeconds: Math.pow(attempts + 1, 2),
    };
  }

  async saveCaptchaTrainingData(captchaImageBase64: string, userInput: string): Promise<void> {
    if (process.env.CAPTCHA_TRAINING_DATA_ENABLED !== 'true') {
      return;
    }

    const imageBuffer = Buffer.from(captchaImageBase64, 'base64');
    if (!userInput || userInput.length > 32 || imageBuffer.length === 0 || imageBuffer.length > 1024 * 1024) {
      this.logger.warn('Skipped invalid CAPTCHA training sample');
      return;
    }

    try {
      const timestamp = new Date().toISOString();
      const baseFilename = `captcha_${timestamp.replace(/[:.]/g, '-')}_${randomUUID()}`;
      await this.s3Service.uploadFile(
        `captcha-training-data/${baseFilename}.json`,
        Buffer.from(JSON.stringify({ solution: userInput, timestamp })),
        'application/json',
      );
      await this.s3Service.uploadFile(`captcha-training-data/${baseFilename}.jpg`, imageBuffer, 'image/jpeg');
      this.logger.debug('Saved opt-in CAPTCHA training sample');
    } catch (error) {
      this.logger.error('Failed to save CAPTCHA training data', error instanceof Error ? error.message : String(error));
    }
  }

  private recordAttempt(userId: string): { cooldownSeconds: number } {
    const now = Date.now();
    const existing = this.userCooldowns.get(userId);
    const attempts = existing && now - existing.lastAttemptTime <= this.resetThresholdMs ? existing.attempts + 1 : 1;
    const cooldownSeconds = Math.pow(attempts, 2);

    this.pruneCooldowns(now);
    this.userCooldowns.set(userId, {
      attempts,
      lastAttemptTime: now,
      cooldownUntil: now + cooldownSeconds * 1000,
    });
    return { cooldownSeconds };
  }

  private pruneCooldowns(now: number): void {
    for (const [userId, cooldown] of this.userCooldowns) {
      if (now - cooldown.lastAttemptTime > this.resetThresholdMs) {
        this.userCooldowns.delete(userId);
      }
    }

    if (this.userCooldowns.size >= this.maxCooldownEntries) {
      const oldestUserId = this.userCooldowns.keys().next().value;
      if (oldestUserId) this.userCooldowns.delete(oldestUserId);
    }
  }
}
