import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class UniversityVerificationRateLimitService {
  private readonly logger = new Logger(UniversityVerificationRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async consumeCaptchaRequest(userId: string): Promise<void> {
    this.assertSafeKeyPart(userId, 'userId');
    await this.consume(`captcha:${userId}`, 5, 10 * 60);
  }

  async consumeValidationAttempt(userId: string, sessionId: string): Promise<void> {
    this.assertSafeKeyPart(userId, 'userId');
    this.assertSessionId(sessionId);
    await this.consume(`validate-user:${userId}`, 20, 10 * 60);
    await this.consume(`validate:${userId}:${sessionId}`, 10, 10 * 60);
  }

  private async consume(keySuffix: string, limit: number, windowSeconds: number): Promise<void> {
    try {
      const key = `university-verification:rate:${keySuffix}`;
      const attempts = await this.redis.incrementWithExpiry(key, windowSeconds);

      if (attempts > limit) {
        throw new HttpException('Muitas tentativas. Aguarde antes de tentar novamente.', HttpStatus.TOO_MANY_REQUESTS);
      }
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }

      this.logger.error('Unable to enforce university verification rate limit', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new ServiceUnavailableException('Não foi possível validar o limite de tentativas. Tente novamente depois.');
    }
  }

  private assertSafeKeyPart(value: string, field: string): void {
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(value)) {
      throw new HttpException(`${field} inválido.`, HttpStatus.BAD_REQUEST);
    }
  }

  private assertSessionId(value: string): void {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
      throw new HttpException('sessionId inválido.', HttpStatus.BAD_REQUEST);
    }
  }
}
