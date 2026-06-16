export const LINKED_ACCOUNT_ROUTE_PATHS = {
  index: '/settings/linked-accounts',
  google: '/settings/linked-accounts/google',
  discord: '/settings/linked-accounts/discord',
  discordRoleSelection: '/settings/linked-accounts/discord/role-selection',
  discordServerAccess: '/settings/linked-accounts/discord/server-access',
  unesp: '/settings/linked-accounts/unesp',
  unespStudentVerification: '/settings/linked-accounts/unesp/student-verification',
} as const;

export type LinkedAccountRoutePath =
  (typeof LINKED_ACCOUNT_ROUTE_PATHS)[keyof typeof LINKED_ACCOUNT_ROUTE_PATHS];

export type LinkedAccountIntegration = 'google' | 'discord' | 'unesp';
