// Privacy directive system inspired by NYT's PURR
// Directives tell products what UI elements to show and how to handle data

export const PRIVACY_DIRECTIVE_TYPES = {
  // User Interface Directives - tell frontend what to show
  UI_COOKIE_BANNER: 'ui_cookie_banner',
  UI_ANALYTICS_CONSENT: 'ui_analytics_consent',
  UI_ERROR_REPORTING_CONSENT: 'ui_error_reporting_consent',
  UI_PERFORMANCE_CONSENT: 'ui_performance_consent',

  // Data Handling Directives - tell products how to handle data
  DATA_ANALYTICS_TRACKING: 'data_analytics_tracking',
  DATA_ERROR_DEBUGGING: 'data_error_debugging',
  DATA_PERFORMANCE_MONITORING: 'data_performance_monitoring',
} as const;

export type PrivacyDirectiveType =
  (typeof PRIVACY_DIRECTIVE_TYPES)[keyof typeof PRIVACY_DIRECTIVE_TYPES];

export const DIRECTIVE_VALUES = {
  SHOW: 'show',
  HIDE: 'hide',
  BLOCK: 'block',
  ALLOW: 'allow',
} as const;

export type DirectiveValue =
  (typeof DIRECTIVE_VALUES)[keyof typeof DIRECTIVE_VALUES];

export interface PrivacyDirective {
  type: PrivacyDirectiveType;
  value: DirectiveValue;
  metadata?: {
    reason?: string;
    timestamp?: Date;
    source?: string;
  };
}

// Cookie name for privacy directives (similar to nyt-purr)
export const PRIVACY_COOKIE_NAME = 'cacic-privacy-directives';

// Header name for privacy directives
export const PRIVACY_HEADER_NAME = 'X-CACIC-Privacy-Directives';
