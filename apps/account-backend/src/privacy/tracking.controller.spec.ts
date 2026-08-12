import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { TrackingController } from './tracking.controller';
import type { PrivacyService } from './privacy.service';

describe('TrackingController', () => {
  it('refreshes tracking as allowed from the analytics preference before cookie banner acceptance', async () => {
    const response = {
      cookie: jest.fn(),
    } as unknown as Response;
    const controller = new TrackingController(
      {
        findUserSettingsForIdentity: jest.fn().mockResolvedValue({
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

    const result = await controller.refreshSessionTracking(
      {
        user: {
          keycloakId: 'keycloak-subject',
        },
      } as never,
      response,
    );

    expect(result).toMatchObject({
      analyticsAllowed: true,
      cookieBannerAccepted: false,
      userId: 'keycloak-subject',
    });
  });

  it('allows tracking when the user has no privacy row yet', async () => {
    const response = {
      cookie: jest.fn(),
    } as unknown as Response;
    const controller = new TrackingController(
      {
        findUserSettingsForIdentity: jest.fn().mockResolvedValue(null),
      } as unknown as PrivacyService,
      createConfigService(),
    );

    const result = await controller.refreshSessionTracking(
      {
        user: {
          keycloakId: 'keycloak-subject',
        },
      } as never,
      response,
    );

    expect(result).toMatchObject({
      analyticsAllowed: true,
      cookieBannerAccepted: false,
      userId: 'keycloak-subject',
    });
  });
});

function createConfigService(): ConfigService {
  return {
    get: jest.fn((key: string) => (key === 'BACKEND_URL' ? 'https://account.cacic.com.br/api' : undefined)),
  } as unknown as ConfigService;
}
