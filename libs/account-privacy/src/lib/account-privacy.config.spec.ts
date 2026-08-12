jest.mock('@angular/core', () => ({
  InjectionToken: class {
    constructor(
      readonly description: string,
      readonly options: unknown,
    ) {}
  },
  makeEnvironmentProviders: (providers: unknown) => providers,
}));

import { DEFAULT_CACIC_ACCOUNT_PRIVACY_CONFIG } from './account-privacy.config';

describe('default account privacy configuration', () => {
  it('enables analytics and monitoring by default without requiring banner acceptance', () => {
    expect(DEFAULT_CACIC_ACCOUNT_PRIVACY_CONFIG).toMatchObject({
      initialPreferences: {
        analytics_tracking: true,
        error_debugging: true,
        performance_monitoring: true,
        cookie_banner_accepted: false,
      },
      unavailablePreferences: {
        analytics_tracking: true,
        error_debugging: true,
        performance_monitoring: true,
        cookie_banner_accepted: false,
      },
      requireCookieBannerAcceptance: false,
    });
  });
});
