export const API_CACHE_KEYS = {
  CURRENT_USER: 'api.currentUser',
  AUTH_STATUS: 'api.authStatus',
  APPLICATIONS: 'api.applications',
  UNESP_ROLE_REQUIRED: 'api.unespRoleRequired',
  LGPD_REQUESTS: 'api.lgpdRequests',
  ONBOARDING_STATUS: 'api.onboardingStatus',
  DISCORD_STATUS: 'api.discordStatus',
  SERVER_SETTINGS: 'api.serverSettings',
  ACCOUNT_MERGE_REQUEST: 'api.accountMergeRequest',
} as const;

export const API_CACHE_DURATIONS = {
  CURRENT_USER: 10 * 60 * 1000,
  AUTH_STATUS: 5 * 60 * 1000,
  APPLICATIONS: 30 * 60 * 1000,
  UNESP_ROLE_REQUIRED: 60 * 60 * 1000,
  LGPD_REQUESTS: 2 * 60 * 1000,
  ONBOARDING_STATUS: 10 * 60 * 1000,
  DISCORD_STATUS: 5 * 60 * 1000,
  SERVER_SETTINGS: 15 * 60 * 1000,
  ACCOUNT_MERGE_REQUEST: 30 * 1000,
} as const;
