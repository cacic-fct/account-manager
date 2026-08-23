import { PrismaService } from '../../prisma/prisma.service';
import { OperationalMetricsService } from './operational-metrics.service';

const createModel = (count: number, createdAt: Date | null) => ({
  count: jest.fn().mockResolvedValue(count),
  findFirst: jest.fn().mockResolvedValue(createdAt ? { createdAt } : null),
});

describe(OperationalMetricsService.name, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('returns aggregate counts and oldest ages without exposing persisted identifiers or errors', async () => {
    const now = new Date('2026-08-23T15:00:00.000Z').getTime();
    jest.spyOn(Date, 'now').mockReturnValue(now);
    const oldest = new Date('2026-08-23T14:00:00.000Z');
    const prisma = {
      deleteAccountRequest: createModel(2, oldest),
      lgpdRequest: createModel(3, oldest),
      accountMergeRequest: createModel(4, oldest),
      accountMergeExternalNotification: createModel(5, oldest),
      studentVerificationDocument: createModel(6, oldest),
    };
    const service = new OperationalMetricsService(prisma as unknown as PrismaService);

    const snapshot = await service.getSnapshot();

    expect(snapshot.domains.accountDeletions.pending).toEqual({ count: 2, oldestAgeSeconds: 3_600 });
    expect(snapshot.domains.lgpdExports.processing).toEqual({ count: 3, oldestAgeSeconds: 3_600 });
    expect(snapshot.domains.accountMerges.failed).toEqual({ count: 4, oldestAgeSeconds: 3_600 });
    expect(snapshot.domains.mergeNotifications.pending).toEqual({ count: 5, oldestAgeSeconds: 3_600 });
    expect(snapshot.domains.studentDocuments.storageCleanupObligations).toEqual({
      count: 6,
      oldestAgeSeconds: 3_600,
    });
    expect(JSON.stringify(snapshot)).not.toContain('user-');
    expect(JSON.stringify(snapshot)).not.toContain('errorMessage');
  });

  it('reports null oldest age for empty persisted states', async () => {
    const emptyModel = createModel(0, null);
    const prisma = {
      deleteAccountRequest: emptyModel,
      lgpdRequest: emptyModel,
      accountMergeRequest: emptyModel,
      accountMergeExternalNotification: emptyModel,
      studentVerificationDocument: emptyModel,
    };
    const service = new OperationalMetricsService(prisma as unknown as PrismaService);

    const snapshot = await service.getSnapshot();

    expect(snapshot.domains.accountDeletions.failed).toEqual({ count: 0, oldestAgeSeconds: null });
    expect(snapshot.domains.studentDocuments.approved).toEqual({ count: 0, oldestAgeSeconds: null });
  });
});
