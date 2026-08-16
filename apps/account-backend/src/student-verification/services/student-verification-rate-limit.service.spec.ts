import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import { StudentVerificationRateLimitService } from './student-verification-rate-limit.service';

describe('StudentVerificationRateLimitService', () => {
  it('limits expensive document uploads with a distributed counter', async () => {
    const redis = { incrementWithExpiry: jest.fn().mockResolvedValue(6) };
    const service = new StudentVerificationRateLimitService(redis as unknown as RedisService);
    await expect(service.consumeUpload('user-1')).rejects.toBeInstanceOf(HttpException);
  });

  it('fails closed when Redis is unavailable', async () => {
    const redis = { incrementWithExpiry: jest.fn().mockRejectedValue(new Error('offline')) };
    const service = new StudentVerificationRateLimitService(redis as unknown as RedisService);
    await expect(service.consumeUpload('user-1')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
