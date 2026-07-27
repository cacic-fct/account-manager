export const ACCOUNT_MERGE_QUEUE = 'account-merge';

export const ACCOUNT_MERGE_JOBS = {
  SCORE_AND_MERGE: 'score-and-merge',
  DELIVER_EXTERNAL_NOTIFICATION: 'deliver-external-notification',
} as const;

export interface ScoreAndMergeJob {
  mergeRequestId: string;
}

export interface DeliverExternalNotificationJob {
  notificationId: string;
  deliveryClaim?: string;
}
