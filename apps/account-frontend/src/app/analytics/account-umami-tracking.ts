import { isPlatformBrowser } from '@angular/common';
import { PLATFORM_ID, inject, isDevMode } from '@angular/core';
import { initCacicUmamiTracking, startCacicUmamiTracking } from '@cacic-fct/account-manager-privacy';

const ACCOUNT_MANAGER_UMAMI_WEBSITE_ID = 'a07cae2c-cb7d-4a5b-ba28-ed81f1d217ae';
const ACCOUNT_MANAGER_UMAMI_IDENTIFY_DATA = {
  source: typeof window === 'undefined' ? 'account-manager' : window.location.hostname,
};

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
    identifyData: ACCOUNT_MANAGER_UMAMI_IDENTIFY_DATA,
  });
}

export async function trackCacicAccountPrivacySettingDisabled(settingKey: string): Promise<void> {
  if (typeof window === 'undefined' || isDevMode()) {
    return;
  }

  const result = await startTrackingForEvent();
  if (!result) {
    return;
  }

  window.umami?.track?.('privacy_setting_disabled', {
    setting: settingKey,
    source: ACCOUNT_MANAGER_UMAMI_IDENTIFY_DATA.source,
  });
}

async function startTrackingForEvent(): Promise<boolean> {
  const result = await initCacicUmamiTracking({
    websiteId: ACCOUNT_MANAGER_UMAMI_WEBSITE_ID,
    identifyData: ACCOUNT_MANAGER_UMAMI_IDENTIFY_DATA,
    trackPageView: false,
  });

  return result.loaded && Boolean(result.userId);
}
