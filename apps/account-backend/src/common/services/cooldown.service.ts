import { Injectable } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

export interface CooldownEntry {
  attempts: number;
  lastAttempt: Date;
  cooldownEndTime: Date;
}

@Injectable()
export class CooldownService {
  private readonly attemptsTtlSeconds = 10 * 60;

  constructor(private readonly redis: RedisService) {}

  /**
   * Check if user is currently on cooldown. Redis is authoritative so every
   * replica observes the same retry window.
   */
  async isOnCooldown(userId: string, action: string): Promise<boolean> {
    return (await this.getRemainingCooldown(userId, action)) > 0;
  }

  /** Get remaining cooldown time in seconds. */
  async getRemainingCooldown(userId: string, action: string): Promise<number> {
    const stateKey = this.stateKey(userId, action);
    const state = await this.redis.get(stateKey);
    if (!state) {
      return 0;
    }

    const ttl = await this.redis.ttl(stateKey);
    // Redis TTL rounds down to whole seconds. A live key reported as zero
    // still represents an active retry window, so fail closed for one second.
    return ttl === 0 ? 1 : ttl > 0 ? ttl : 0;
  }

  /** Get current attempts count for user action. */
  async getAttempts(userId: string, action: string): Promise<number> {
    const value = await this.redis.get(this.attemptsKey(userId, action));
    const attempts = Number(value ?? 0);
    return Number.isSafeInteger(attempts) && attempts >= 0 ? attempts : 0;
  }

  /** Add or increment cooldown for user action (exponential backoff: 2^n seconds). */
  async setCooldown(userId: string, action: string): Promise<CooldownEntry> {
    const now = new Date();
    const result = await this.redis.eval(
      `local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local effectiveAttempts = attempts
if effectiveAttempts > 30 then
  effectiveAttempts = 30
end
local cooldown = 2 ^ effectiveAttempts
redis.call('SET', KEYS[2], tostring(effectiveAttempts), 'EX', cooldown)
return { effectiveAttempts, cooldown }`,
      [this.attemptsKey(userId, action), this.stateKey(userId, action)],
      [this.attemptsTtlSeconds.toString()],
    );
    const [attempts, cooldownSeconds] = this.parseEvalResult(result);

    return {
      attempts,
      lastAttempt: now,
      cooldownEndTime: new Date(now.getTime() + cooldownSeconds * 1000),
    };
  }

  /** Clear cooldown for user action (used on successful operations). */
  async clearCooldown(userId: string, action: string): Promise<void> {
    await Promise.all([
      this.redis.del(this.stateKey(userId, action)),
      this.redis.del(this.attemptsKey(userId, action)),
    ]);
  }

  /** Redis TTLs clean up expired entries; no process-local sweep is needed. */
  cleanupExpiredCooldowns(): number {
    return 0;
  }

  private parseEvalResult(result: unknown): [number, number] {
    if (!Array.isArray(result)) {
      throw new Error('Redis returned an invalid cooldown result');
    }
    const attempts = Number(result[0]);
    const cooldownSeconds = Number(result[1]);
    if (
      !Number.isSafeInteger(attempts) ||
      attempts < 1 ||
      !Number.isSafeInteger(cooldownSeconds) ||
      cooldownSeconds < 1
    ) {
      throw new Error('Redis returned an invalid cooldown result');
    }
    return [attempts, cooldownSeconds];
  }

  private keyPart(value: string): string {
    return encodeURIComponent(value);
  }

  private attemptsKey(userId: string, action: string): string {
    return `discord:cooldown:attempts:${this.keyPart(userId)}:${this.keyPart(action)}`;
  }

  private stateKey(userId: string, action: string): string {
    return `discord:cooldown:state:${this.keyPart(userId)}:${this.keyPart(action)}`;
  }
}
