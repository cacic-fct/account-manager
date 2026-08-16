import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { ExternalVerificationResilienceService } from './university-validation/services/external-verification-resilience.service';

@Injectable()
export class AppService {
  constructor(
    private readonly redisService: RedisService,
    private readonly externalVerificationResilience: ExternalVerificationResilienceService,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth() {
    const timestamp = new Date().toISOString();
    const externalUniversityVerification = this.externalVerificationResilience.getStatus();

    try {
      // Test Redis connection
      await this.redisService.get('health-check');

      return {
        status: 'ok',
        timestamp,
        services: {
          redis: 'connected',
          externalUniversityVerification,
        },
      };
    } catch (error) {
      return {
        status: 'degraded',
        timestamp,
        services: {
          redis: 'disconnected',
          externalUniversityVerification,
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
