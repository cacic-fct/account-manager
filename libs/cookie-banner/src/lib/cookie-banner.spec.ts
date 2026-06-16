import { CookieBanner, createCookieBanner } from './cookie-banner';

describe('CookieBanner', () => {
  it('creates a banner instance without auto mounting', () => {
    const banner = createCookieBanner({ autoMount: false });

    expect(banner).toBeInstanceOf(CookieBanner);

    banner.destroy();
  });
});
