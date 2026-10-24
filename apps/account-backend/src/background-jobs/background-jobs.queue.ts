import type { JobsOptions } from 'bullmq';

export const BACKGROUND_JOBS_QUEUE = 'background-maintenance';
export type BackgroundJobData = Record<string, never>;
export function getBackgroundJobTimeZone(): string {
  return process.env.TZ?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone;
}

export const RECURRING_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { count: 100 },
  removeOnFail: { count: 1_000 },
} satisfies JobsOptions;

export const BACKGROUND_JOBS = {
  USER_SCHEMA: 'reconcile-user-schema',
  MERGE_SCORING: 'recover-merge-scoring',
  MERGE_NOTIFICATIONS: 'recover-merge-notifications',
  INTERRUPTED_MERGES: 'recover-interrupted-merges',
  LGPD_CLEANUP: 'cleanup-lgpd',
  DOCUMENT_RETENTION: 'cleanup-student-documents',
} as const;

export const BACKGROUND_JOB_SCHEDULES = [
  { name: BACKGROUND_JOBS.USER_SCHEMA, repeat: { pattern: '*/5 * * * *' } },
  { name: BACKGROUND_JOBS.MERGE_SCORING, repeat: { pattern: '*/5 * * * *' } },
  { name: BACKGROUND_JOBS.MERGE_NOTIFICATIONS, repeat: { pattern: '*/5 * * * *' } },
  { name: BACKGROUND_JOBS.INTERRUPTED_MERGES, repeat: { pattern: '*/5 * * * *' } },
  { name: BACKGROUND_JOBS.LGPD_CLEANUP, repeat: { pattern: '0 3 * * *' } },
  { name: BACKGROUND_JOBS.DOCUMENT_RETENTION, repeat: { every: 24 * 60 * 60 * 1_000 } },
] as const;
