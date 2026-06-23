export type CacicDateTime = string | Date;
export type PrivacyMetadata = Record<string, unknown>;

export const M2M_API_PREFIX = '/api' as const;

export const M2M_PRIVACY_ROLES = {
  READ: 'privacy:read',
  WRITE: 'privacy:write',
} as const;

export type M2MPrivacyRole =
  (typeof M2M_PRIVACY_ROLES)[keyof typeof M2M_PRIVACY_ROLES];

export const PRIVACY_SETTING_TYPES = {
  ANALYTICS_TRACKING: 'analytics_tracking',
  ERROR_DEBUGGING: 'error_debugging',
  PERFORMANCE_MONITORING: 'performance_monitoring',
  COOKIE_BANNER_ACCEPTED: 'cookie_banner_accepted',
} as const;

export const PRIVACY_SETTING_TYPE_VALUES = Object.values(
  PRIVACY_SETTING_TYPES,
);

export type PrivacySettingTypeValue =
  (typeof PRIVACY_SETTING_TYPES)[keyof typeof PRIVACY_SETTING_TYPES];

export interface PrivacySettings {
  analytics_tracking: boolean;
  error_debugging: boolean;
  performance_monitoring: boolean;
  cookie_banner_accepted: boolean;
}

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  analytics_tracking: false,
  error_debugging: false,
  performance_monitoring: false,
  cookie_banner_accepted: false,
};

export function createDefaultPrivacySettings(): PrivacySettings {
  return { ...DEFAULT_PRIVACY_SETTINGS };
}

export interface PrivacySettingRecord {
  id: string;
  userId: string;
  settings: PrivacySettings;
  metadata?: PrivacyMetadata;
  createdAt: CacicDateTime;
  updatedAt: CacicDateTime;
}

export interface PrivacySettingUpdate {
  enabled: boolean;
  metadata?: PrivacyMetadata;
}

export interface BulkUpdatePrivacySettingsByType {
  analytics_tracking?: PrivacySettingUpdate;
  error_debugging?: PrivacySettingUpdate;
  cookie_banner_accepted?: PrivacySettingUpdate;
  performance_monitoring?: PrivacySettingUpdate;
}

export interface M2MPrivacySettingUpdate {
  settingType: PrivacySettingTypeValue;
  enabled: boolean;
  metadata?: PrivacyMetadata;
}

export interface M2MBulkPrivacySettingsRequest {
  settings: M2MPrivacySettingUpdate[];
}

export interface M2MPrivacySettingResponse {
  settingType: PrivacySettingTypeValue;
  enabled: boolean;
  lastUpdated: CacicDateTime;
}

export interface M2MCookieConsentResponse {
  hasConsent: boolean;
  consentDate: CacicDateTime | null;
}

export interface M2MRecordCookieConsentResponse {
  success: boolean;
}

export interface M2MBulkPrivacySettingsResponse {
  success: boolean;
  updated: number;
}

export const PRIVACY_DIRECTIVE_TYPES = {
  UI_COOKIE_BANNER: 'ui_cookie_banner',
  UI_ANALYTICS_CONSENT: 'ui_analytics_consent',
  UI_ERROR_REPORTING_CONSENT: 'ui_error_reporting_consent',
  UI_PERFORMANCE_CONSENT: 'ui_performance_consent',
  DATA_ANALYTICS_TRACKING: 'data_analytics_tracking',
  DATA_ERROR_DEBUGGING: 'data_error_debugging',
  DATA_PERFORMANCE_MONITORING: 'data_performance_monitoring',
} as const;

export type PrivacyDirectiveType =
  (typeof PRIVACY_DIRECTIVE_TYPES)[keyof typeof PRIVACY_DIRECTIVE_TYPES];

export type PrivacyUiDirectiveType = Extract<
  PrivacyDirectiveType,
  `ui_${string}`
>;

export type PrivacyDataDirectiveType = Extract<
  PrivacyDirectiveType,
  `data_${string}`
>;

export const DIRECTIVE_VALUES = {
  SHOW: 'show',
  HIDE: 'hide',
  BLOCK: 'block',
  ALLOW: 'allow',
} as const;

export type DirectiveValue =
  (typeof DIRECTIVE_VALUES)[keyof typeof DIRECTIVE_VALUES];

export type PrivacyUiDirectiveValue =
  | typeof DIRECTIVE_VALUES.SHOW
  | typeof DIRECTIVE_VALUES.HIDE;

export type PrivacyDataDirectiveValue =
  | typeof DIRECTIVE_VALUES.ALLOW
  | typeof DIRECTIVE_VALUES.BLOCK;

export interface PrivacyDirectiveMetadata {
  reason?: string;
  timestamp?: CacicDateTime;
  source?: string;
  [key: string]: unknown;
}

export interface PrivacyDirective {
  type: PrivacyDirectiveType;
  value: DirectiveValue;
  metadata?: PrivacyDirectiveMetadata;
}

export type PrivacyDirectiveUiMap = Partial<
  Record<PrivacyUiDirectiveType, PrivacyUiDirectiveValue>
>;

export type PrivacyDirectiveDataMap = Partial<
  Record<PrivacyDataDirectiveType, PrivacyDataDirectiveValue>
>;

export interface PrivacyDirectivesResponse {
  directives: PrivacyDirective[];
  ui: PrivacyDirectiveUiMap;
  data: PrivacyDirectiveDataMap;
}

export const PRIVACY_COOKIE_NAME = 'cacic-privacy-directives' as const;
export const PRIVACY_HEADER_NAME = 'X-CACIC-Privacy-Directives' as const;
export const CACIC_PURR_COOKIE_NAME = 'cacic-purr' as const;
export const CACIC_PURR_QUICK_COOKIE_NAME = 'cacic-purr-quick' as const;
export const CACIC_ANALYTICS_ID_COOKIE_NAME = 'cacic-analytics-id' as const;
export const CACIC_ANALYTICS_CONSENT_COOKIE_NAME =
  'cacic-analytics-consent' as const;

export interface CacicPurrCookiePayload {
  directives: Partial<Record<PrivacyDirectiveType, DirectiveValue>>;
  userId: string;
  expires: string;
  lastUpdated: string;
  version: string;
}

export interface CacicPurrQuickCookiePayload {
  cookieBanner: PrivacyUiDirectiveValue;
  analyticsAllowed: boolean;
}

export interface CacicAnalyticsConsentCookiePayload {
  analyticsAllowed: boolean;
  cookieBannerAccepted: boolean;
  identityAvailable: boolean;
  updatedAt: CacicDateTime;
  version: string;
}

export interface CacicTrackingSessionResponse {
  analyticsAllowed: boolean;
  cookieBannerAccepted: boolean;
  userId?: string;
  expiresAt?: CacicDateTime;
}

export const M2M_PRIVACY_ROUTE_TEMPLATES = {
  USER_SETTINGS: `${M2M_API_PREFIX}/v1/privacy/user/:userId/settings`,
  USER_SETTING: `${M2M_API_PREFIX}/v1/privacy/user/:userId/setting/:settingType`,
  COOKIE_CONSENT: `${M2M_API_PREFIX}/v1/privacy/user/:userId/cookie-consent`,
  BULK_SETTINGS: `${M2M_API_PREFIX}/v1/privacy/user/:userId/settings/bulk`,
  DIRECTIVES: `${M2M_API_PREFIX}/privacy-directives?userId=:userId`,
  UI_DIRECTIVES: `${M2M_API_PREFIX}/privacy-directives/ui?userId=:userId`,
  DATA_DIRECTIVES: `${M2M_API_PREFIX}/privacy-directives/data?userId=:userId`,
} as const;

export const CACIC_TRACKING_ROUTES = {
  session: `${M2M_API_PREFIX}/tracking/session`,
  clear: `${M2M_API_PREFIX}/tracking/clear`,
} as const;

export const M2M_PRIVACY_ROUTES = {
  userSettings: (userId: string) =>
    `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(userId)}/settings`,
  userSetting: (userId: string, settingType: PrivacySettingTypeValue) =>
    `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(
      userId,
    )}/setting/${settingType}`,
  cookieConsent: (userId: string) =>
    `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(
      userId,
    )}/cookie-consent`,
  bulkSettings: (userId: string) =>
    `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(
      userId,
    )}/settings/bulk`,
  directives: (userId: string) =>
    `${M2M_API_PREFIX}/privacy-directives?userId=${encodeQueryValue(userId)}`,
  uiDirectives: (userId: string) =>
    `${M2M_API_PREFIX}/privacy-directives/ui?userId=${encodeQueryValue(
      userId,
    )}`,
  dataDirectives: (userId: string) =>
    `${M2M_API_PREFIX}/privacy-directives/data?userId=${encodeQueryValue(
      userId,
    )}`,
} as const;

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value);
}
