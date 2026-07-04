import { ConfigService } from '@nestjs/config';
import { FeatureFlagService } from './feature-flags.service';
import { GLOBAL_FEATURE_FLAGS } from './feature-flags.constants';

type ConfigValues = Record<string, string | undefined>;
type FetchMock = jest.Mock<ReturnType<typeof fetch>, Parameters<typeof fetch>>;
type FetchInitWithHeaders = RequestInit & {
  headers: Record<string, string>;
};

const createService = (values: ConfigValues = {}) => {
  const configService = {
    get: jest.fn((key: string) => values[key]),
  };

  return new FeatureFlagService(configService as unknown as ConfigService);
};

const createFetchMock = (): FetchMock => jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>();

const getFetchInit = (fetchMock: FetchMock): FetchInitWithHeaders => {
  const call = fetchMock.mock.calls[0];
  if (!call) {
    throw new Error('Expected fetch to be called.');
  }

  return call[1] as FetchInitWithHeaders;
};

describe('FeatureFlagService', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  it('reads the global undergraduate verification disable flag from Unleash', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          toggles: [
            {
              name: GLOBAL_FEATURE_FLAGS.undergraduateUnespRoleVerificationDisabled,
              enabled: true,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
      UNLEASH_APP_NAME: 'account-manager-backend-test',
      UNLEASH_ENVIRONMENT: 'production',
    });

    await expect(service.isUndergraduateUnespRoleVerificationDisabled()).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('https://unleash.cacic.dev.br/api/frontend', expect.any(Object));
    expect(getFetchInit(fetchMock).headers).toMatchObject({
      Authorization: 'client-key',
      'UNLEASH-APPNAME': 'account-manager-backend-test',
      'UNLEASH-ENVIRONMENT': 'production',
    });
  });

  it('fails closed when Unleash cannot be reached', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockRejectedValue(new Error('offline'));
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
    });

    await expect(service.isUndergraduateUnespRoleVerificationDisabled()).resolves.toBe(false);
  });

  it('uses cached flag values while the cache entry is fresh', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: 'feature-a',
            enabled: true,
          },
        ]),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
      UNLEASH_CACHE_TTL_MS: '10000',
    });

    await expect(service.isEnabled('feature-a', false)).resolves.toBe(true);
    await expect(service.isEnabled('feature-a', false)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back when no frontend client key is available', async () => {
    const fetchMock = createFetchMock();
    global.fetch = fetchMock;
    const service = createService();
    const internals = service as unknown as {
      readClientKey: () => string;
    };
    internals.readClientKey = () => '';

    await expect(service.isEnabled('feature-a', true)).resolves.toBe(true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back when Unleash returns a non-OK response', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(new Response('', { status: 503 }));
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
      UNLEASH_TIMEOUT_MS: 'not-a-number',
    });

    await expect(service.isEnabled('feature-a', false)).resolves.toBe(false);
  });

  it('reads feature payloads and default production client settings', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          features: [
            null,
            {
              name: 'feature-a',
              enabled: false,
            },
          ],
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const service = createService({
      NODE_ENV: 'production',
      UNLEASH_API_URL: 'https://unleash.example.test/frontend',
    });

    await expect(service.isEnabled('feature-a', true)).resolves.toBe(false);

    expect(fetchMock).toHaveBeenCalledWith('https://unleash.example.test/frontend', expect.any(Object));
    const init = getFetchInit(fetchMock);
    expect(init.headers.Authorization).toContain('default:production.');
    expect(init.headers['UNLEASH-ENVIRONMENT']).toBe('production');
  });

  it('uses fallback values for malformed toggle payloads', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(new Response(JSON.stringify('bad'), { status: 200 }));
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
    });

    await expect(service.isEnabled('feature-a', true)).resolves.toBe(true);
  });

  it('uses fallback values when feature payload collections are malformed', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          toggles: 'bad',
          features: 'also-bad',
        }),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
    });

    await expect(service.isEnabled('feature-a', true)).resolves.toBe(true);
  });

  it('uses development defaults when no Unleash environment is configured', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify([
          {
            name: 'feature-a',
            enabled: true,
          },
        ]),
        { status: 200 },
      ),
    );
    global.fetch = fetchMock;
    const service = createService();

    await expect(service.isEnabled('feature-a', false)).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledWith('https://unleash.cacic.dev.br/api/frontend', expect.any(Object));
    const init = getFetchInit(fetchMock);
    expect(init.headers.Authorization).toContain('default:development.');
    expect(init.headers['UNLEASH-ENVIRONMENT']).toBe('development');
  });

  it('falls back after non-Error Unleash failures', async () => {
    const fetchMock = createFetchMock();
    fetchMock.mockRejectedValue('offline');
    global.fetch = fetchMock;
    const service = createService({
      UNLEASH_FRONTEND_CLIENT_KEY: 'client-key',
    });

    await expect(service.isEnabled('feature-a', true)).resolves.toBe(true);
  });
});
