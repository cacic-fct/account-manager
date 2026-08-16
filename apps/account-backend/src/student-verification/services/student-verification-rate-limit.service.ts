import { HttpException, HttpStatus, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class StudentVerificationRateLimitService {
  private readonly logger = new Logger(StudentVerificationRateLimitService.name);

  constructor(private readonly redis: RedisService) {}

  async consumeUpload(userId: string): Promise<void> {
    try {
      const attempts = await this.redis.incrementWithExpiry(`student-verification:rate:upload:${userId}`, 60 * 60);
      if (attempts > 5) {
        throw new HttpException(
          'Muitos documentos enviados. Aguarde antes de tentar novamente.',
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.error('Unable to enforce student document upload rate limit');
      throw new ServiceUnavailableException('Não foi possível validar o limite de envios. Tente novamente depois.');
    }
  }
}
