import type { ConfigService } from '@nestjs/config';
import { DIRECTIVE_VALUES, PRIVACY_DIRECTIVE_TYPES, type PrivacyDirective } from '../constants/privacy-directives';
import { PrivacyDirectiveService } from './privacy-directive.service';
import type { PrivacyService } from '../privacy.service';

describe('PrivacyDirectiveService', () => {
  it('allows analytics tracking from the analytics preference even before the banner is accepted', async () => {
    const service = new PrivacyDirectiveService(
      {
        findUserSettings: jest.fn().mockResolvedValue({
          settings: {
            analytics_tracking: true,
            cookie_banner_accepted: false,
            error_debugging: false,
            performance_monitoring: false,
          },
          updatedAt: new Date('2026-07-07T12:00:00.000Z'),
        }),
      } as unknown as PrivacyService,
      createConfigService(),
    );

    const directives = await service.generateDirectivesForUser('keycloak-subject');

    expect(findDirective(directives, PRIVACY_DIRECTIVE_TYPES.UI_COOKIE_BANNER)?.value).toBe(DIRECTIVE_VALUES.SHOW);
    expect(findDirective(directives, PRIVACY_DIRECTIVE_TYPES.DATA_ANALYTICS_TRACKING)?.value).toBe(
      DIRECTIVE_VALUES.ALLOW,
    );
    expect(findDirective(directives, PRIVACY_DIRECTIVE_TYPES.DATA_ERROR_DEBUGGING)?.value).toBe(DIRECTIVE_VALUES.BLOCK);
  });
});

function findDirective(directives: PrivacyDirective[], type: PrivacyDirective['type']): PrivacyDirective | undefined {
  return directives.find((directive) => directive.type === type);
}

function createConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'SESSION_SECRET' ? 'test-secret' : undefined)),
  } as unknown as ConfigService;
}
