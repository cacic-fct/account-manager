import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { RedisService } from '../../redis/redis.service';
import { UniversityVerificationRateLimitService } from './university-verification-rate-limit.service';

describe('UniversityVerificationRateLimitService', () => {
  it('enforces the distributed captcha budget', async () => {
    const redis = {
      incrementWithExpiry: jest.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(6),
    };
    const service = new UniversityVerificationRateLimitService(redis as unknown as RedisService);

    await service.consumeCaptchaRequest('user-1');
    await expect(service.consumeCaptchaRequest('user-1')).rejects.toBeInstanceOf(HttpException);
    expect(redis.incrementWithExpiry).toHaveBeenCalledWith('university-verification:rate:captcha:user-1', 600);
  });

  it('fails closed when Redis is unavailable', async () => {
    const redis = { incrementWithExpiry: jest.fn().mockRejectedValue(new Error('offline')) };
    const service = new UniversityVerificationRateLimitService(redis as unknown as RedisService);
    await expect(
      service.consumeValidationAttempt('user-1', '33e39a04-9c47-4c24-a136-3cb98ca71b65'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects unbounded or unsafe session identifiers before touching Redis', async () => {
    const redis = { incrementWithExpiry: jest.fn() };
    const service = new UniversityVerificationRateLimitService(redis as unknown as RedisService);

    await expect(service.consumeValidationAttempt('user-1', 'invalid:session')).rejects.toBeInstanceOf(HttpException);
    expect(redis.incrementWithExpiry).not.toHaveBeenCalled();
  });
});
