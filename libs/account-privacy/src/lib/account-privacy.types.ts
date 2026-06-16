import type {
  CacicDateTime,
  PrivacyMetadata,
  PrivacySettings,
  PrivacySettingTypeValue,
} from '@cacic-fct/m2m-contracts';

export type CacicPrivacySettingKey = PrivacySettingTypeValue;
export type CacicPrivacyPreferences = PrivacySettings;
export type CacicPrivacyMetadata = PrivacyMetadata;

export interface CacicAccountPrivacySetting {
  id: string;
  userId: string;
  settings: CacicPrivacyPreferences;
  metadata?: CacicPrivacyMetadata;
  createdAt: CacicDateTime;
  updatedAt: CacicDateTime;
}
