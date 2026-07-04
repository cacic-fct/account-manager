import { CookieBanner, createCookieBanner, hasAcceptedCookieBanner, saveAcceptedCookieBanner } from './cookie-banner';

describe('CookieBanner', () => {
  const cookieStore = new Map<string, string>();
  const localStorageStore = new Map<string, string>();

  beforeEach(() => {
    cookieStore.clear();
    localStorageStore.clear();

    Object.defineProperty(globalThis, 'document', {
      configurable: true,
      value: {
        get cookie(): string {
          return Array.from(cookieStore.entries())
            .map(([name, value]) => `${name}=${value}`)
            .join('; ');
        },
        set cookie(value: string) {
          const [cookiePair, ...attributes] = value.split(';');
          const [name, cookieValue = ''] = cookiePair.split('=');
          const isExpired = attributes.some((attribute) => attribute.trim().toLowerCase() === 'max-age=0');

          if (isExpired) {
            cookieStore.delete(name);
            return;
          }

          cookieStore.set(name, cookieValue);
        },
      },
    });

    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        clear: () => localStorageStore.clear(),
        getItem: (key: string) => localStorageStore.get(key) ?? null,
        setItem: (key: string, value: string) => {
          localStorageStore.set(key, value);
        },
      },
    });
  });

  it('creates a banner instance without auto mounting', () => {
    const banner = createCookieBanner({ autoMount: false });

    expect(banner).toBeInstanceOf(CookieBanner);

    banner.destroy();
  });

  it('stores acceptance in a cookie and localStorage', () => {
    saveAcceptedCookieBanner();

    expect(hasAcceptedCookieBanner()).toBe(true);
    expect(globalThis.localStorage?.getItem('cacic.cookieBanner.accepted')).toBe('true');
    expect(document.cookie).toContain('cacic_cookie_banner_accepted=true');
  });

  it('uses the acceptance cookie before localStorage', () => {
    document.cookie = 'cacic_cookie_banner_accepted=true; Max-Age=31536000; path=/; SameSite=Lax';

    expect(hasAcceptedCookieBanner()).toBe(true);
    expect(globalThis.localStorage?.getItem('cacic.cookieBanner.accepted')).toBeNull();
  });
});
