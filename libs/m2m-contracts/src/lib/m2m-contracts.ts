export type CacicDateTime = string | Date;
export type PrivacyMetadata = Record<string, unknown>;

export const M2M_API_PREFIX = '/api' as const;

export const M2M_PRIVACY_ROLES = {
  READ: 'privacy:read',
  WRITE: 'privacy:write',
} as const;

export type M2MPrivacyRole = (typeof M2M_PRIVACY_ROLES)[keyof typeof M2M_PRIVACY_ROLES];

export const M2M_USER_ROLES = {
  READ: 'users:read',
} as const;

export type M2MUserRole = (typeof M2M_USER_ROLES)[keyof typeof M2M_USER_ROLES];

export type M2MUserIdentifierType = 'cpf' | 'phone' | 'email';

export interface M2MUserProfile {
  userId: string;
  enrollmentNumber?: string | null;
  name: string;
  email?: string | null;
}

export interface M2MUserEnrollmentLookupRequest {
  enrollmentNumbers: string[];
}

export interface M2MUserEnrollmentLookupResponse {
  users: M2MUserProfile[];
}

export interface M2MUserIdentifierLookupItem {
  requestId: string;
  identifierType: M2MUserIdentifierType;
  identifierValue: string;
}

export interface M2MUserIdentifierLookupRequest {
  identifiers: M2MUserIdentifierLookupItem[];
}

export type M2MUserIdentifierLookupMatch = M2MUserProfile & {
  requestId: string;
};

export interface M2MUserIdentifierLookupResponse {
  users: M2MUserIdentifierLookupMatch[];
}

export const M2M_TOTP_ROLES = {
  VALIDATE: 'totp:validate',
  RELAY: 'totp:relay',
} as const;

export type M2MTotpRole = (typeof M2M_TOTP_ROLES)[keyof typeof M2M_TOTP_ROLES];

export const TOTP_ALGORITHM = 'SHA512' as const;
export const TOTP_DIGITS = 6 as const;
export const TOTP_PERIOD_SECONDS = 30 as const;
export const TOTP_VALIDATION_WINDOW_STEPS = 1 as const;

export type TotpAlgorithm = typeof TOTP_ALGORITHM;

export interface TotpSeedPayload {
  userId: string;
  primaryEmail: string;
  seed: string;
  algorithm: TotpAlgorithm;
  digits: typeof TOTP_DIGITS;
  periodSeconds: typeof TOTP_PERIOD_SECONDS;
  serverTime: CacicDateTime;
}

export interface TotpStatusResponse {
  configured: boolean;
  algorithm: TotpAlgorithm;
  digits: typeof TOTP_DIGITS;
  periodSeconds: typeof TOTP_PERIOD_SECONDS;
  serverTime: CacicDateTime;
  createdAt?: CacicDateTime;
  rotatedAt?: CacicDateTime;
}

export type TotpSeedResponse = TotpSeedPayload;

export interface M2MTotpValidateRequest {
  primaryEmail: string;
  code: string;
}

export interface M2MTotpValidateResponse {
  valid: boolean;
  serverTime: CacicDateTime;
  userId?: string;
  primaryEmail?: string;
  matchedStepOffset?: -1 | 0 | 1;
}

export type M2MTotpSeedRelayResponse = TotpSeedPayload;

export const PRIVACY_SETTING_TYPES = {
  ANALYTICS_TRACKING: 'analytics_tracking',
  ERROR_DEBUGGING: 'error_debugging',
  PERFORMANCE_MONITORING: 'performance_monitoring',
  COOKIE_BANNER_ACCEPTED: 'cookie_banner_accepted',
} as const;

export const PRIVACY_SETTING_TYPE_VALUES = Object.values(PRIVACY_SETTING_TYPES);

export type PrivacySettingTypeValue = (typeof PRIVACY_SETTING_TYPES)[keyof typeof PRIVACY_SETTING_TYPES];

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

export type PrivacyDirectiveType = (typeof PRIVACY_DIRECTIVE_TYPES)[keyof typeof PRIVACY_DIRECTIVE_TYPES];

export type PrivacyUiDirectiveType = Extract<PrivacyDirectiveType, `ui_${string}`>;

export type PrivacyDataDirectiveType = Extract<PrivacyDirectiveType, `data_${string}`>;

export const DIRECTIVE_VALUES = {
  SHOW: 'show',
  HIDE: 'hide',
  BLOCK: 'block',
  ALLOW: 'allow',
} as const;

export type DirectiveValue = (typeof DIRECTIVE_VALUES)[keyof typeof DIRECTIVE_VALUES];

export type PrivacyUiDirectiveValue = typeof DIRECTIVE_VALUES.SHOW | typeof DIRECTIVE_VALUES.HIDE;

export type PrivacyDataDirectiveValue = typeof DIRECTIVE_VALUES.ALLOW | typeof DIRECTIVE_VALUES.BLOCK;

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

export type PrivacyDirectiveUiMap = Partial<Record<PrivacyUiDirectiveType, PrivacyUiDirectiveValue>>;

export type PrivacyDirectiveDataMap = Partial<Record<PrivacyDataDirectiveType, PrivacyDataDirectiveValue>>;

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
export const CACIC_ANALYTICS_CONSENT_COOKIE_NAME = 'cacic-analytics-consent' as const;

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

export const M2M_TOTP_ROUTE_TEMPLATES = {
  VALIDATE: `${M2M_API_PREFIX}/v1/totp/validate`,
  SEED_RELAY: `${M2M_API_PREFIX}/v1/totp/user/:userId/seed`,
  ENSURE_SEED: `${M2M_API_PREFIX}/v1/totp/user/:userId/seed`,
} as const;

export const M2M_USER_ROUTE_TEMPLATES = {
  ENROLLMENT_LOOKUP: `${M2M_API_PREFIX}/v1/users/enrollment-lookup`,
  IDENTIFIER_LOOKUP: `${M2M_API_PREFIX}/v1/users/identifier-lookup`,
} as const;

export const M2M_TOTP_ROUTES = {
  validate: () => `${M2M_API_PREFIX}/v1/totp/validate`,
  seedRelay: (userId: string) => `${M2M_API_PREFIX}/v1/totp/user/${encodePathSegment(userId)}/seed`,
  ensureSeed: (userId: string) => `${M2M_API_PREFIX}/v1/totp/user/${encodePathSegment(userId)}/seed`,
} as const;

export const M2M_USER_ROUTES = {
  enrollmentLookup: () => `${M2M_API_PREFIX}/v1/users/enrollment-lookup`,
  identifierLookup: () => `${M2M_API_PREFIX}/v1/users/identifier-lookup`,
} as const;

export const M2M_PRIVACY_ROUTES = {
  userSettings: (userId: string) => `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(userId)}/settings`,
  userSetting: (userId: string, settingType: PrivacySettingTypeValue) =>
    `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(userId)}/setting/${settingType}`,
  cookieConsent: (userId: string) => `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(userId)}/cookie-consent`,
  bulkSettings: (userId: string) => `${M2M_API_PREFIX}/v1/privacy/user/${encodePathSegment(userId)}/settings/bulk`,
  directives: (userId: string) => `${M2M_API_PREFIX}/privacy-directives?userId=${encodeQueryValue(userId)}`,
  uiDirectives: (userId: string) => `${M2M_API_PREFIX}/privacy-directives/ui?userId=${encodeQueryValue(userId)}`,
  dataDirectives: (userId: string) => `${M2M_API_PREFIX}/privacy-directives/data?userId=${encodeQueryValue(userId)}`,
} as const;

function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

function encodeQueryValue(value: string): string {
  return encodeURIComponent(value);
}

type SubtleCryptoLike = {
  importKey: (
    format: 'raw',
    keyData: Uint8Array,
    algorithm: { name: 'HMAC'; hash: 'SHA-512' },
    extractable: false,
    keyUsages: ['sign'],
  ) => Promise<unknown>;
  sign: (algorithm: 'HMAC', key: unknown, data: ArrayBuffer) => Promise<ArrayBuffer>;
};

export interface GenerateTotpCodeOptions {
  seed: string;
  timestamp?: number;
  periodSeconds?: number;
  digits?: number;
}

export async function generateTotpCode({
  seed,
  timestamp = Date.now(),
  periodSeconds = TOTP_PERIOD_SECONDS,
  digits = TOTP_DIGITS,
}: GenerateTotpCodeOptions): Promise<string> {
  const counter = Math.floor(timestamp / 1000 / periodSeconds);
  const keyData = decodeBase32(seed);
  const key = await resolveSubtleCrypto().importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-512' }, false, ['sign']);
  const signature = new Uint8Array(await resolveSubtleCrypto().sign('HMAC', key, counterToBuffer(counter)));
  const offset = signature[signature.length - 1] & 0x0f;
  const binary =
    ((signature[offset] & 0x7f) << 24) |
    ((signature[offset + 1] & 0xff) << 16) |
    ((signature[offset + 2] & 0xff) << 8) |
    (signature[offset + 3] & 0xff);
  const otp = binary % 10 ** digits;

  return otp.toString().padStart(digits, '0');
}

export function formatTotpCode(code: string): string {
  const normalizedCode = code.replace(/\D/g, '').slice(0, TOTP_DIGITS);
  return normalizedCode.length <= 3 ? normalizedCode : `${normalizedCode.slice(0, 3)} ${normalizedCode.slice(3)}`;
}

export function getTotpRemainingSeconds(timestamp = Date.now(), periodSeconds = TOTP_PERIOD_SECONDS): number {
  const elapsedSeconds = Math.floor(timestamp / 1000) % periodSeconds;
  return periodSeconds - elapsedSeconds;
}

function decodeBase32(value: string): Uint8Array {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const normalized = value.toUpperCase().replace(/[\s=-]/g, '');
  const bytes: number[] = [];
  let bits = 0;
  let bitCount = 0;

  for (const character of normalized) {
    const index = alphabet.indexOf(character);
    if (index === -1) {
      throw new Error('Invalid TOTP seed.');
    }

    bits = (bits << 5) | index;
    bitCount += 5;

    if (bitCount >= 8) {
      bytes.push((bits >>> (bitCount - 8)) & 0xff);
      bitCount -= 8;
    }
  }

  return new Uint8Array(bytes);
}

function counterToBuffer(counter: number): ArrayBuffer {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  const high = Math.floor(counter / 0x100000000);
  const low = counter >>> 0;

  view.setUint32(0, high, false);
  view.setUint32(4, low, false);

  return buffer;
}

function resolveSubtleCrypto(): SubtleCryptoLike {
  const cryptoLike = globalThis.crypto as { subtle?: SubtleCryptoLike } | undefined;

  if (!cryptoLike?.subtle) {
    throw new Error('Web Crypto API is not available.');
  }

  return cryptoLike.subtle;
}
