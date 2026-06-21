export interface PrivacyDirective {
  type: 'ui' | 'data-handling';
  name: string;
  action: 'show' | 'hide' | 'enable' | 'disable';
  metadata?: Record<string, unknown>;
}

export interface PrivacyDirectives {
  cookieBanner: PrivacyDirective;
  analyticsTracking: PrivacyDirective;
  errorDebugging: PrivacyDirective;
  performanceMonitoring: PrivacyDirective;
}

export interface PrivacyDirectiveResponse {
  directives: PrivacyDirectives;
  userId?: string;
  timestamp: string;
}
