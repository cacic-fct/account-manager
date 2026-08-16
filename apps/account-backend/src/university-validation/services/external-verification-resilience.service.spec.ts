import { ConfigService } from '@nestjs/config';
import {
  ExternalVerificationResilienceService,
  ExternalVerificationUnavailableError,
} from './external-verification-resilience.service';

const createService = (values: Record<string, string> = {}) =>
  new ExternalVerificationResilienceService({
    get: (name: string) => values[name],
  } as ConfigService);

describe('ExternalVerificationResilienceService', () => {
  it.each(['false', '0', 'no', 'off'])('honors the hard kill switch value %s', (value) => {
    const service = createService({ UNIVERSITY_EXTERNAL_VERIFICATION_ENABLED: value });
    expect(() => service.assertAvailable()).toThrow(ExternalVerificationUnavailableError);
    expect(service.getStatus()).toMatchObject({ enabled: false, state: 'disabled' });
  });

  it('opens the circuit after the configured number of failures', async () => {
    const service = createService({ UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD: '2' });
    await expect(service.execute('captcha', async () => Promise.reject(new Error('offline')))).rejects.toMatchObject({
      reason: 'upstream_failure',
    });
    await expect(service.execute('captcha', async () => Promise.reject(new Error('offline')))).rejects.toMatchObject({
      reason: 'upstream_failure',
    });
    expect(() => service.assertAvailable()).toThrow(ExternalVerificationUnavailableError);
    expect(service.getStatus().state).toBe('open');
  });

  it('rejects work above the concurrency bulkhead', async () => {
    const service = createService({ UNIVERSITY_EXTERNAL_MAX_CONCURRENT_REQUESTS: '1' });
    let release!: () => void;
    const pending = service.execute('captcha', () => new Promise<void>((resolve) => (release = resolve)));
    await Promise.resolve();

    await expect(service.execute('captcha', () => Promise.resolve(undefined))).rejects.toMatchObject({
      reason: 'overloaded',
    });
    release();
    await pending;
  });

  it('allows only one half-open probe after the reset interval', async () => {
    jest.useFakeTimers();
    const service = createService({
      UNIVERSITY_EXTERNAL_FAILURE_THRESHOLD: '1',
      UNIVERSITY_EXTERNAL_CIRCUIT_RESET_MS: '10',
    });
    await expect(service.execute('captcha', () => Promise.reject(new Error('offline')))).rejects.toBeDefined();
    jest.advanceTimersByTime(10);

    let release!: () => void;
    const probe = service.execute('captcha', () => new Promise<void>((resolve) => (release = resolve)));
    await expect(service.execute('captcha', () => Promise.resolve())).rejects.toMatchObject({
      reason: 'circuit_open',
    });
    release();
    await probe;
    jest.useRealTimers();
  });
});
