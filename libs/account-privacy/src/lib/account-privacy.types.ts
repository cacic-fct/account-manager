import type {
  CacicTrackingSessionResponse,
  CacicDateTime,
  PrivacyMetadata,
  PrivacySettings,
  PrivacySettingTypeValue,
} from '@cacic-fct/account-manager-m2m-contracts';

export type CacicPrivacySettingKey = PrivacySettingTypeValue;
export type CacicPrivacyPreferences = PrivacySettings;
export type CacicPrivacyMetadata = PrivacyMetadata;
export type CacicTrackingSession = CacicTrackingSessionResponse;

export interface CacicAccountPrivacySetting {
  id: string;
  userId: string;
  settings: CacicPrivacyPreferences;
  metadata?: CacicPrivacyMetadata;
  createdAt: CacicDateTime;
  updatedAt: CacicDateTime;
}
