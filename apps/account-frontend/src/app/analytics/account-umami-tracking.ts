import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject, isDevMode } from '@angular/core';
import { startCacicUmamiTracking } from '@cacic-fct/account-manager-privacy';

const ACCOUNT_MANAGER_UMAMI_WEBSITE_ID = 'a07cae2c-cb7d-4a5b-ba28-ed81f1d217ae';

export function startCacicAccountUmamiTracking(): void {
  if (!isPlatformBrowser(inject(PLATFORM_ID)) || isDevMode()) {
    return;
  }

  startCacicUmamiTracking({
    websiteId: ACCOUNT_MANAGER_UMAMI_WEBSITE_ID,
    recorder: {
      src: 'https://a.cacic.dev.br/recorder.js',
      sampleRate: 1,
      maskLevel: 'moderate',
      maxDuration: 1_200_000,
    },
    identifyData: {
      source: window.location.hostname,
    },
  });
}
