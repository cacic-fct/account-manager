import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';

@Injectable()
export class AppService {
  constructor(private readonly redisService: RedisService) {}

  getHello(): string {
    return 'Hello World!';
  }

  async getHealth() {
    const timestamp = new Date().toISOString();

    try {
      // Test Redis connection
      await this.redisService.get('health-check');

      return {
        status: 'ok',
        timestamp,
        services: {
          redis: 'connected',
        },
      };
    } catch (error) {
      return {
        status: 'degraded',
        timestamp,
        services: {
          redis: 'disconnected',
        },
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }
}
