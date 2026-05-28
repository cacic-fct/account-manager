export const PRIVACY_SETTING_TYPES = {
  ANALYTICS_TRACKING: 'analytics_tracking',
  ERROR_DEBUGGING: 'error_debugging',
  PERFORMANCE_MONITORING: 'performance_monitoring',
  COOKIE_BANNER_ACCEPTED: 'cookie_banner_accepted',
} as const;

export const PRIVACY_SETTING_TYPE_VALUES = Object.values(PRIVACY_SETTING_TYPES);

export type PrivacySettingTypeValue =
  (typeof PRIVACY_SETTING_TYPES)[keyof typeof PRIVACY_SETTING_TYPES];

export interface PrivacySettings {
  analytics_tracking: boolean;
  error_debugging: boolean;
  performance_monitoring: boolean;
  cookie_banner_accepted: boolean;
}
