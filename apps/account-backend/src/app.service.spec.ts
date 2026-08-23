import { AppService } from './app.service';
import { setAccountManagerGrpcReady } from './grpc/account-manager-grpc.server';

describe(AppService.name, () => {
  const redis = { get: jest.fn() };
  const resilience = {
    getStatus: jest.fn().mockReturnValue({
      enabled: true,
      state: 'available',
      inFlightRequests: 0,
      retryAfterMs: 0,
    }),
  };
  const prisma = { $queryRaw: jest.fn() };
  const keycloak = { isRealmReachable: jest.fn() };
  const s3 = { fileExists: jest.fn() };
  let service: AppService;

  beforeEach(() => {
    jest.clearAllMocks();
    redis.get.mockResolvedValue(null);
    prisma.$queryRaw.mockResolvedValue([1]);
    keycloak.isRealmReachable.mockResolvedValue(true);
    s3.fileExists.mockResolvedValue(false);
    setAccountManagerGrpcReady(true);
    service = new AppService(redis as never, resilience as never, prisma as never, keycloak as never, s3 as never);
  });

  it('keeps liveness independent from dependency readiness', () => {
    const liveness = service.getLiveness();

    expect(liveness.status).toBe('ok');
    expect(typeof liveness.timestamp).toBe('string');
  });

  it('reports stable readiness component states without raw dependency errors', async () => {
    redis.get.mockRejectedValue(new Error('redis://internal-host:6379 secret detail'));

    const health = await service.getHealth();

    expect(health.status).toBe('degraded');
    expect(health.services).toMatchObject({
      redis: 'unavailable',
      database: 'connected',
      keycloak: 'connected',
      queues: 'unavailable',
    });
    expect(JSON.stringify(health)).not.toContain('internal-host');
    expect(health).not.toHaveProperty('error');
  });
});
