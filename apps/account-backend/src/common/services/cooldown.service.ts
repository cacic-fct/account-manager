import { Injectable } from '@nestjs/common';

interface CooldownEntry {
  attempts: number;
  lastAttempt: Date;
  cooldownEndTime: Date;
}

@Injectable()
export class CooldownService {
  private cooldowns = new Map<string, CooldownEntry>();

  /**
   * Check if user is currently on cooldown
   */
  isOnCooldown(userId: string, action: string): boolean {
    const key = `${userId}:${action}`;
    const entry = this.cooldowns.get(key);

    if (!entry) {
      return false;
    }

    const now = new Date();
    if (now >= entry.cooldownEndTime) {
      // Cooldown has expired, remove entry
      this.cooldowns.delete(key);
      return false;
    }

    return true;
  }

  /**
   * Get remaining cooldown time in seconds
   */
  getRemainingCooldown(userId: string, action: string): number {
    const key = `${userId}:${action}`;
    const entry = this.cooldowns.get(key);

    if (!entry) {
      return 0;
    }

    const now = new Date();
    const remainingMs = entry.cooldownEndTime.getTime() - now.getTime();

    if (remainingMs <= 0) {
      this.cooldowns.delete(key);
      return 0;
    }

    return Math.ceil(remainingMs / 1000);
  }

  /**
   * Get current attempts count for user action
   */
  getAttempts(userId: string, action: string): number {
    const key = `${userId}:${action}`;
    const entry = this.cooldowns.get(key);
    return entry?.attempts || 0;
  }

  /**
   * Add or increment cooldown for user action (exponential backoff: 2^n seconds)
   */
  setCooldown(userId: string, action: string): CooldownEntry {
    const key = `${userId}:${action}`;
    const existing = this.cooldowns.get(key);
    const now = new Date();

    const attempts = (existing?.attempts || 0) + 1;
    const cooldownSeconds = Math.pow(2, attempts);
    const cooldownEndTime = new Date(now.getTime() + cooldownSeconds * 1000);

    const entry: CooldownEntry = {
      attempts,
      lastAttempt: now,
      cooldownEndTime,
    };

    this.cooldowns.set(key, entry);
    return entry;
  }

  /**
   * Clear cooldown for user action (used on successful operations)
   */
  clearCooldown(userId: string, action: string): void {
    const key = `${userId}:${action}`;
    this.cooldowns.delete(key);
  }

  /**
   * Clean up expired cooldowns (optional maintenance method)
   */
  cleanupExpiredCooldowns(): number {
    const now = new Date();
    let removedCount = 0;

    for (const [key, entry] of this.cooldowns.entries()) {
      if (now >= entry.cooldownEndTime) {
        this.cooldowns.delete(key);
        removedCount++;
      }
    }

    return removedCount;
  }
}
