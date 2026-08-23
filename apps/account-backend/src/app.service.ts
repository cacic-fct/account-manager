import { Injectable } from '@nestjs/common';
import { RedisService } from './redis/redis.service';
import { ExternalVerificationResilienceService } from './university-validation/services/external-verification-resilience.service';
import { PrismaService } from './prisma/prisma.service';
import { KeycloakService } from './auth/services/keycloak.service';
import { S3Service } from './common/services/s3.service';
import { isAccountManagerGrpcReady } from './grpc/account-manager-grpc.server';

@Injectable()
export class AppService {
  constructor(
    private readonly redisService: RedisService,
    private readonly externalVerificationResilience: ExternalVerificationResilienceService,
    private readonly prisma: PrismaService,
    private readonly keycloak: KeycloakService,
    private readonly s3: S3Service,
  ) {}

  getHello(): string {
    return 'Hello World!';
  }

  getLiveness() {
    return {
      status: 'ok' as const,
      timestamp: new Date().toISOString(),
    };
  }

  async getHealth() {
    const timestamp = new Date().toISOString();
    const externalUniversityVerification = this.externalVerificationResilience.getStatus();
    const [redis, database, keycloak, storage] = await Promise.allSettled([
      this.withTimeout(this.redisService.get('health-check'), 3_000),
      this.withTimeout(this.prisma.$queryRaw`SELECT 1`, 3_000),
      this.withTimeout(this.keycloak.isRealmReachable(), 6_000),
      this.withTimeout(this.s3.fileExists('__account-manager-readiness__'), 3_000),
    ]);
    const services = {
      redis: redis.status === 'fulfilled' ? 'connected' : 'unavailable',
      database: database.status === 'fulfilled' ? 'connected' : 'unavailable',
      keycloak: keycloak.status === 'fulfilled' && keycloak.value ? 'connected' : 'unavailable',
      storage: storage.status === 'fulfilled' ? 'connected' : 'unavailable',
      grpc: isAccountManagerGrpcReady() ? 'listening' : 'unavailable',
      queues: redis.status === 'fulfilled' ? 'available' : 'unavailable',
      discord: process.env.DISCORD_BOT_TOKEN && process.env.DISCORD_GUILD_ID ? 'configured' : 'disabled',
      externalUniversityVerification,
    };
    const ready =
      services.redis === 'connected' &&
      services.database === 'connected' &&
      services.keycloak === 'connected' &&
      services.storage === 'connected' &&
      services.grpc === 'listening';

    return {
      status: ready ? ('ok' as const) : ('degraded' as const),
      timestamp,
      services,
    };
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new Error('Dependency readiness check timed out')), timeoutMs);
          timeout.unref();
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }
}
