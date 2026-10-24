import { TestBed } from '@angular/core/testing';
import { CookieBannerComponent } from '@cacic-fct/account-manager-cookie-banner/angular';
import { CookieBanner, hasAcceptedCookieBanner } from '@cacic-fct/account-manager-cookie-banner';

describe('silent cookie banner failures', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const storedValues = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storedValues.get(key) ?? null,
      setItem: (key: string, value: string) => storedValues.set(key, value),
      removeItem: (key: string) => storedValues.delete(key),
    });
    document.cookie = 'cacic_cookie_banner_accepted=; Max-Age=0; path=/';
  });

  afterEach(() => {
    document.querySelectorAll('.cacic-cookie-banner').forEach((element) => element.remove());
    localStorage.removeItem('cacic.cookieBanner.accepted');
    document.cookie = 'cacic_cookie_banner_accepted=; Max-Age=0; path=/';
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each(['unconfirmed', 'rejected'])(
    'dismisses the Angular banner after an %s save without offering retry',
    async (failure) => {
      const onAccept = vi
        .fn()
        .mockImplementation(() =>
          failure === 'unconfirmed' ? Promise.resolve(false) : Promise.reject(new Error('private server details')),
        );
      const fixture = TestBed.createComponent(CookieBannerComponent);
      fixture.componentRef.setInput('config', { onAccept });
      fixture.detectChanges();
      await fixture.whenStable();
      fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      host.querySelector<HTMLButtonElement>('button')?.click();
      await fixture.whenStable();
      fixture.detectChanges();

      expect(host.querySelector('[role="alert"]')).toBeNull();
      expect(host.querySelector('section')).toBeNull();
      expect(hasAcceptedCookieBanner()).toBe(true);
      expect(onAccept).toHaveBeenCalledTimes(1);

      const nextFixture = TestBed.createComponent(CookieBannerComponent);
      nextFixture.componentRef.setInput('config', { onAccept });
      nextFixture.detectChanges();
      await nextFixture.whenStable();
      nextFixture.detectChanges();
      expect((nextFixture.nativeElement as HTMLElement).querySelector('section')).toBeNull();
      expect(onAccept).toHaveBeenCalledTimes(1);
    },
  );

  it.each(['unconfirmed', 'rejected'])(
    'dismisses the JavaScript banner after an %s save without offering retry',
    async (failure) => {
      const onAccept = vi
        .fn()
        .mockImplementation(() =>
          failure === 'unconfirmed' ? Promise.resolve(false) : Promise.reject(new Error('private server details')),
        );
      const banner = new CookieBanner({ autoMount: false, onAccept });
      try {
        await banner.init();
        document.querySelector<HTMLButtonElement>('.cacic-cookie-banner_accept')?.click();
        await vi.waitFor(() => expect(document.querySelector('.cacic-cookie-banner')).toBeNull());
        expect(document.querySelector('.cacic-cookie-banner [role="alert"]')).toBeNull();
        expect(hasAcceptedCookieBanner()).toBe(true);
        expect(onAccept).toHaveBeenCalledTimes(1);

        const nextBanner = new CookieBanner({ autoMount: false, onAccept });
        await nextBanner.init();
        expect(document.querySelector('.cacic-cookie-banner')).toBeNull();
        expect(onAccept).toHaveBeenCalledTimes(1);
        nextBanner.destroy();
      } finally {
        banner.destroy();
      }
    },
  );
});
