import { initCacicUmamiTracking } from './umami-tracking';

describe('umami tracking', () => {
  const cookieStore = new Map<string, string>();
  const elements = new Map<string, FakeScriptElement>();

  let identify: jest.Mock;

  beforeEach(() => {
    cookieStore.clear();
    elements.clear();
    identify = jest.fn();

    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: jest.fn().mockResolvedValue({ ok: false, status: 401 }),
    });

    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        location: {
          hostname: 'cacic.dev.br',
        },
        umami: {
          identify,
        },
      },
    });

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        createElement: () => new FakeScriptElement(),
        get cookie(): string {
          return Array.from(cookieStore.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
        },
        set cookie(value: string) {
          const [cookiePair] = value.split(';');
          const [name, cookieValue = ''] = cookiePair.split('=');
          cookieStore.set(name, cookieValue);
        },
        getElementById: (id: string) => elements.get(id) ?? null,
        head: {
          append: (script: FakeScriptElement) => {
            elements.set(script.id, script);
            script.dispatchLoad();
          },
        },
      },
    });
  });

  it('loads Umami anonymously when Account Manager has no authenticated session', async () => {
    const result = await initCacicUmamiTracking({
      websiteId: 'site-id',
      identifyData: {
        source: 'cacic.dev.br',
      },
    });

    expect(result).toMatchObject({
      analyticsAllowed: true,
      isAnonymous: true,
      loaded: true,
      reason: 'loaded',
      userId: null,
    });
    expect(elements.get('cacic-umami-site-id')).toMatchObject({
      src: 'https://a.cacic.dev.br/b.js',
    });
    expect(identify).not.toHaveBeenCalled();
  });

  it('does not load Umami when the consent cookie explicitly disables analytics', async () => {
    writeCookie('cacic-analytics-consent', {
      analyticsAllowed: false,
      cookieBannerAccepted: true,
      identityAvailable: false,
      updatedAt: '2026-07-08T12:00:00.000Z',
      version: '1.0',
    });

    const result = await initCacicUmamiTracking({
      websiteId: 'site-id',
    });

    expect(result).toMatchObject({
      analyticsAllowed: false,
      cookieBannerAccepted: true,
      isAnonymous: false,
      loaded: false,
      reason: 'analytics_disabled',
      userId: null,
    });
    expect(elements.has('cacic-umami-site-id')).toBe(false);
    expect(identify).not.toHaveBeenCalled();
  });

  it('identifies the user when tracking cookies provide an analytics identity', async () => {
    writeCookie('cacic-analytics-id', 'keycloak-subject');
    writeCookie('cacic-analytics-consent', {
      analyticsAllowed: true,
      cookieBannerAccepted: false,
      identityAvailable: true,
      updatedAt: '2026-07-08T12:00:00.000Z',
      version: '1.0',
    });

    const result = await initCacicUmamiTracking({
      websiteId: 'site-id',
      identifyData: {
        source: 'cacic.dev.br',
      },
    });

    expect(result).toMatchObject({
      analyticsAllowed: true,
      cookieBannerAccepted: false,
      isAnonymous: false,
      loaded: true,
      reason: 'loaded',
      userId: 'keycloak-subject',
    });
    expect(identify).toHaveBeenCalledWith({
      cookie_banner_accepted: false,
      id: 'keycloak-subject',
      source: 'cacic.dev.br',
    });
  });

  function writeCookie(name: string, value: string | Record<string, unknown>): void {
    cookieStore.set(name, encodeURIComponent(typeof value === 'string' ? value : JSON.stringify(value)));
  }
});

class FakeScriptElement {
  readonly dataset: Record<string, string> = {};
  defer = false;
  id = '';
  src = '';
  private readonly listeners = new Map<string, Array<() => void>>();

  addEventListener(event: string, listener: () => void): void {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  remove(): void {
    // The tests assert whether scripts are appended; removal behavior is covered by integration callers.
  }

  dispatchLoad(): void {
    for (const listener of this.listeners.get('load') ?? []) {
      listener();
    }
  }
}
