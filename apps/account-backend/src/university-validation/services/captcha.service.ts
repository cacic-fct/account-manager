import { Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { S3Service } from '../../common/services/s3.service';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class CaptchaService {
  private readonly logger = new Logger(CaptchaService.name);
  private readonly resetThresholdSeconds = 10 * 60;

  constructor(
    private readonly s3Service: S3Service,
    @Optional() private readonly redisService?: RedisService,
  ) {}

  async isUserInCooldown(userId: string): Promise<{
    inCooldown: boolean;
    remainingSeconds: number;
  }> {
    const status = await this.getCooldownStatus(userId);
    return {
      inCooldown: status.inCooldown,
      remainingSeconds: status.remainingSeconds,
    };
  }

  async recordFailedAttempt(userId: string): Promise<{ cooldownSeconds: number }> {
    return this.recordAttempt(userId);
  }

  async recordCaptchaRequest(userId: string): Promise<{ cooldownSeconds: number }> {
    return this.recordAttempt(userId);
  }

  async recordSuccessfulAttempt(userId: string): Promise<void> {
    const redis = this.requireRedis();
    await Promise.all([redis.del(this.cooldownKey(userId)), redis.del(this.attemptsKey(userId))]);
  }

  async getCooldownStatus(userId: string): Promise<{
    inCooldown: boolean;
    remainingSeconds: number;
    attempts: number;
    nextCooldownSeconds: number;
  }> {
    const redis = this.requireRedis();
    const [cooldownValue, attemptsValue] = await Promise.all([
      redis.get(this.cooldownKey(userId)),
      redis.get(this.attemptsKey(userId)),
    ]);
    const attempts = this.parseAttempts(attemptsValue ?? cooldownValue);
    const cooldownTtl = cooldownValue ? await redis.ttl(this.cooldownKey(userId)) : 0;
    // Redis TTL rounds down to whole seconds. Treat a live key with a zero
    // TTL as one second remaining so a boundary request cannot bypass the
    // cooldown before the key is actually expired.
    const remainingSeconds = cooldownValue && cooldownTtl === 0 ? 1 : Math.max(0, cooldownTtl);

    return {
      inCooldown: remainingSeconds > 0,
      remainingSeconds,
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

  private async recordAttempt(userId: string): Promise<{ cooldownSeconds: number }> {
    const redis = this.requireRedis();
    const result = await redis.eval(
      `local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local cooldown = attempts * attempts
redis.call('SET', KEYS[2], tostring(attempts), 'EX', cooldown)
return { attempts, cooldown }`,
      [this.attemptsKey(userId), this.cooldownKey(userId)],
      [this.resetThresholdSeconds.toString()],
    );
    const [attempts, cooldownSeconds] = this.parseEvalResult(result);
    return { cooldownSeconds: cooldownSeconds ?? Math.pow(attempts, 2) };
  }

  private parseEvalResult(result: unknown): [number, number | undefined] {
    if (!Array.isArray(result)) {
      throw new Error('Redis returned an invalid CAPTCHA cooldown result');
    }
    const attempts = Number(result[0]);
    const cooldownSeconds = result.length > 1 ? Number(result[1]) : undefined;
    if (
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      (cooldownSeconds !== undefined && !Number.isFinite(cooldownSeconds))
    ) {
      throw new Error('Redis returned an invalid CAPTCHA cooldown result');
    }
    return [attempts, cooldownSeconds];
  }

  private parseAttempts(value: string | null): number {
    const attempts = Number(value ?? 0);
    return Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
  }

  private requireRedis(): RedisService {
    if (!this.redisService) {
      throw new Error('Distributed CAPTCHA state is unavailable');
    }
    return this.redisService;
  }

  private attemptsKey(userId: string): string {
    return `university-validation:captcha:attempts:${encodeURIComponent(userId)}`;
  }

  private cooldownKey(userId: string): string {
    return `university-validation:captcha:cooldown:${encodeURIComponent(userId)}`;
  }
}
