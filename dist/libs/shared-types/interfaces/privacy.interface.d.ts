export interface PrivacySettings {
    analytics_tracking: boolean;
    error_debugging: boolean;
    performance_monitoring: boolean;
    cookie_banner_accepted: boolean;
}
export type PrivacyMetadata = Record<string, unknown>;
export interface PrivacySetting {
    id: string;
    userId: string;
    settings: PrivacySettings;
    metadata?: PrivacyMetadata;
    createdAt: Date;
    updatedAt: Date;
}
export interface UpdatePrivacySetting {
    enabled: boolean;
    metadata?: PrivacyMetadata;
}
export interface BulkUpdatePrivacySettings {
    analytics_tracking?: UpdatePrivacySetting;
    error_debugging?: UpdatePrivacySetting;
    cookie_banner_accepted?: UpdatePrivacySetting;
    performance_monitoring?: UpdatePrivacySetting;
}
export interface CookieBannerStatus {
    shouldShow: boolean;
}
//# sourceMappingURL=privacy.interface.d.ts.map