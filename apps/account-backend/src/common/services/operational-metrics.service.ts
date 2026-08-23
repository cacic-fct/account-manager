import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface OperationalMetric {
  count: number;
  oldestAgeSeconds: number | null;
}

export interface OperationalMetricsSnapshot {
  generatedAt: string;
  domains: {
    accountDeletions: {
      pending: OperationalMetric;
      processing: OperationalMetric;
      failed: OperationalMetric;
      storageCleanupObligations: OperationalMetric;
    };
    lgpdExports: {
      pending: OperationalMetric;
      processing: OperationalMetric;
      failed: OperationalMetric;
      expiredFiles: OperationalMetric;
    };
    accountMerges: {
      pending: OperationalMetric;
      processing: OperationalMetric;
      failed: OperationalMetric;
    };
    mergeNotifications: {
      pending: OperationalMetric;
      failed: OperationalMetric;
    };
    studentDocuments: {
      pending: OperationalMetric;
      rejected: OperationalMetric;
      approved: OperationalMetric;
      storageCleanupObligations: OperationalMetric;
    };
  };
}

type MetricModel = {
  count(args: { where: Record<string, unknown> }): Promise<number>;
  findFirst(args: {
    where: Record<string, unknown>;
    orderBy: Record<string, 'asc' | 'desc'>;
    select: { createdAt: true };
  }): Promise<{ createdAt: Date } | null>;
};

@Injectable()
export class OperationalMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSnapshot(): Promise<OperationalMetricsSnapshot> {
    const [
      accountDeletionPending,
      accountDeletionProcessing,
      accountDeletionFailed,
      accountDeletionStorage,
      lgpdPending,
      lgpdProcessing,
      lgpdFailed,
      lgpdExpiredFiles,
      mergePending,
      mergeProcessing,
      mergeFailed,
      notificationPending,
      notificationFailed,
      studentPending,
      studentRejected,
      studentApproved,
      studentStorage,
    ] = await Promise.all([
      this.metric(this.prisma.deleteAccountRequest, { status: 'pending' }),
      this.metric(this.prisma.deleteAccountRequest, { status: 'processing' }),
      this.metric(this.prisma.deleteAccountRequest, { status: 'failed' }),
      this.metric(this.prisma.deleteAccountRequest, {
        OR: [
          { status: 'failed', errorMessage: { not: null } },
          { status: 'processing', errorMessage: { not: null } },
        ],
      }),
      this.metric(this.prisma.lgpdRequest, { status: 'pending' }),
      this.metric(this.prisma.lgpdRequest, { status: 'processing' }),
      this.metric(this.prisma.lgpdRequest, { status: 'failed' }),
      this.metric(this.prisma.lgpdRequest, {
        status: 'completed',
        expiresAt: { lt: new Date() },
        s3Key: { not: null },
      }),
      this.metric(this.prisma.accountMergeRequest, { status: 'pending' }),
      this.metric(this.prisma.accountMergeRequest, { status: 'processing' }),
      this.metric(this.prisma.accountMergeRequest, { status: 'failed' }),
      this.metric(this.prisma.accountMergeExternalNotification, { status: 'pending' }),
      this.metric(this.prisma.accountMergeExternalNotification, { status: 'failed' }),
      this.metric(this.prisma.studentVerificationDocument, { status: 'pending' }),
      this.metric(this.prisma.studentVerificationDocument, { status: 'rejected' }),
      this.metric(this.prisma.studentVerificationDocument, { status: 'approved' }),
      this.metric(this.prisma.studentVerificationDocument, {
        OR: [{ status: 'approved', s3Key: { not: null } }, { verifiedBy: { startsWith: 'retention-policy:' } }],
      }),
    ]);

    return {
      generatedAt: new Date().toISOString(),
      domains: {
        accountDeletions: {
          pending: accountDeletionPending,
          processing: accountDeletionProcessing,
          failed: accountDeletionFailed,
          storageCleanupObligations: accountDeletionStorage,
        },
        lgpdExports: {
          pending: lgpdPending,
          processing: lgpdProcessing,
          failed: lgpdFailed,
          expiredFiles: lgpdExpiredFiles,
        },
        accountMerges: {
          pending: mergePending,
          processing: mergeProcessing,
          failed: mergeFailed,
        },
        mergeNotifications: {
          pending: notificationPending,
          failed: notificationFailed,
        },
        studentDocuments: {
          pending: studentPending,
          rejected: studentRejected,
          approved: studentApproved,
          storageCleanupObligations: studentStorage,
        },
      },
    };
  }

  private async metric(model: unknown, where: Record<string, unknown>): Promise<OperationalMetric> {
    const metricModel = model as MetricModel;
    const [count, oldest] = await Promise.all([
      metricModel.count({ where }),
      metricModel.findFirst({
        where,
        orderBy: { createdAt: 'asc' },
        select: { createdAt: true },
      }),
    ]);

    return {
      count,
      oldestAgeSeconds: oldest ? this.ageInSeconds(oldest.createdAt) : null,
    };
  }

  private ageInSeconds(createdAt: Date): number {
    return Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 1_000));
  }
}
