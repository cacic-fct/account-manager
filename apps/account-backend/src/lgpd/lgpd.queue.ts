export const LGPD_QUEUE = 'lgpd';

export const LGPD_JOBS = {
  PROCESS_DATA_REQUEST: 'process-data-request',
  SOFT_DELETE_ACCOUNT: 'soft-delete-account',
  HARD_DELETE_ACCOUNT: 'hard-delete-account',
} as const;

export interface ProcessDataRequestJob {
  requestId: string;
}

export interface AccountDeletionJob {
  requestId: string;
}
