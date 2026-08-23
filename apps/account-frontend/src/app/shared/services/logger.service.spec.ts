import { TestBed } from '@angular/core/testing';
import { ErrorTrackingService } from './error-tracking.service';
import { LoggerService } from './logger.service';

describe('LoggerService', () => {
  it('redacts profile data before console or telemetry output', () => {
    const errorTracking = {
      trackError: vi.fn(),
      trackWarning: vi.fn(),
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        LoggerService,
        { provide: ErrorTrackingService, useValue: errorTracking },
      ],
    });

    const service = TestBed.inject(LoggerService);
    service.error('Profile request failed', new Error('sentinel-error'), {
      userId: 'opaque-user-id',
      email: 'sentinel@example.com',
      phone: '+5518999990000',
      profile: { fullname: 'Sentinel User' },
    });
    service.warn('Profile warning', { currentUser: { email: 'sentinel@example.com' } });

    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('sentinel@example.com');
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain('Sentinel User');
    expect(JSON.stringify(errorTracking.trackError.mock.calls)).not.toContain('sentinel@example.com');
    expect(JSON.stringify(errorTracking.trackWarning.mock.calls)).not.toContain('sentinel@example.com');

    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
