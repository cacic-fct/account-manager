import {
  CACIC_ANALYTICS_CONSENT_COOKIE_NAME,
  CACIC_ANALYTICS_ID_COOKIE_NAME,
  CACIC_TRACKING_ROUTES,
  type CacicAnalyticsConsentCookiePayload,
  type CacicTrackingSessionResponse,
} from '@cacic-fct/account-manager-m2m-contracts';

export interface CacicUmamiGlobal {
  identify?: (data: CacicUmamiIdentifyPayload) => void;
  track?: (eventNameOrData?: string | Record<string, unknown>, eventData?: Record<string, unknown>) => void;
}

export interface CacicUmamiIdentifyPayload extends Record<string, unknown> {
  id: string;
}

export interface CacicTrackingIdentity {
  analyticsAllowed: boolean;
  cookieBannerAccepted: boolean;
  isAnonymous?: boolean;
  userId: string | null;
}

export interface CacicUmamiTrackingConfig {
  websiteId: string;
  accountApiBaseUrl?: string;
  scriptSrc?: string;
  domains?: string[];
  autoTrack?: boolean;
  identify?: boolean;
  trackPageView?: boolean;
  identifyData?: Record<string, unknown>;
  recorder?: CacicUmamiRecorderConfig;
}

export interface CacicUmamiRecorderConfig {
  src?: string;
  sampleRate?: number;
  maskLevel?: 'none' | 'light' | 'moderate' | 'strict';
  maxDuration?: number;
}

export type StopCacicUmamiTracking = () => void;

export interface CacicUmamiTrackingResult extends CacicTrackingIdentity {
  loaded: boolean;
  reason: 'loaded' | 'missing_website_id' | 'not_browser' | 'analytics_disabled' | 'missing_identity' | 'script_failed';
}

declare global {
  interface Window {
    umami?: CacicUmamiGlobal;
  }
}

const DEFAULT_ACCOUNT_API_BASE_URL = 'https://account.cacic.dev.br/api';
const DEFAULT_UMAMI_SCRIPT_SRC = 'https://a.cacic.dev.br/b.js';

export async function initCacicUmamiTracking(config: CacicUmamiTrackingConfig): Promise<CacicUmamiTrackingResult> {
  if (!config.websiteId) {
    return disabledResult('missing_website_id');
  }

  if (!isBrowser()) {
    return disabledResult('not_browser');
  }

  const identity = await resolveCacicTrackingIdentity(config);

  if (!identity.analyticsAllowed) {
    unloadCacicUmamiTracking(config);
    return { ...identity, loaded: false, reason: 'analytics_disabled' };
  }

  const loaded = await loadUmamiScript(config);
  if (!loaded) {
    return { ...identity, loaded: false, reason: 'script_failed' };
  }

  if (config.identify !== false && identity.userId) {
    window.umami?.identify?.({
      cookie_banner_accepted: identity.cookieBannerAccepted,
      ...config.identifyData,
      id: identity.userId,
    });
  }

  if (config.trackPageView !== false && config.autoTrack === false) {
    window.umami?.track?.();
  }

  loadRecorderScript(config);

  return { ...identity, loaded: true, reason: 'loaded' };
}

export async function resolveCacicTrackingIdentity(
  config: Pick<CacicUmamiTrackingConfig, 'accountApiBaseUrl'> = {},
): Promise<CacicTrackingIdentity> {
  if (!isBrowser()) {
    return {
      analyticsAllowed: false,
      cookieBannerAccepted: false,
      isAnonymous: true,
      userId: null,
    };
  }

  await requestTrackingCookieRefresh(config.accountApiBaseUrl);

  const cookies = readCacicTrackingCookies();
  if (cookies.consent?.analyticsAllowed === false) {
    return {
      analyticsAllowed: false,
      cookieBannerAccepted: cookies.consent.cookieBannerAccepted,
      isAnonymous: false,
      userId: null,
    };
  }

  return {
    analyticsAllowed: true,
    cookieBannerAccepted: cookies.consent?.cookieBannerAccepted === true,
    isAnonymous: cookies.consent?.identityAvailable !== true,
    userId: cookies.consent?.identityAvailable === true ? cookies.analyticsId : null,
  };
}

export function readCacicTrackingCookies(): {
  analyticsId: string | null;
  consent: CacicAnalyticsConsentCookiePayload | null;
} {
  if (!isBrowser()) {
    return { analyticsId: null, consent: null };
  }

  return {
    analyticsId: readCookie(CACIC_ANALYTICS_ID_COOKIE_NAME),
    consent: readConsentCookie(readCookie(CACIC_ANALYTICS_CONSENT_COOKIE_NAME)),
  };
}

export function clearClientTrackingCookies(): void {
  if (!isBrowser()) {
    return;
  }

  for (const cookieName of [CACIC_ANALYTICS_ID_COOKIE_NAME, CACIC_ANALYTICS_CONSENT_COOKIE_NAME]) {
    expireCookie(cookieName);
    expireCookie(cookieName, resolveCurrentSharedCookieDomain());
  }
}

export function startCacicUmamiTracking(config: CacicUmamiTrackingConfig): StopCacicUmamiTracking | null {
  if (!isBrowser()) {
    return null;
  }

  const run = (): void => {
    void initCacicUmamiTracking(config);
  };
  const events = ['cookieBannerAccepted', 'cacicTrackingConsentChanged', 'pageshow'] as const;

  run();

  for (const event of events) {
    window.addEventListener(event, run);
  }

  return () => {
    for (const event of events) {
      window.removeEventListener(event, run);
    }
  };
}

export function startCacicUmamiTrackingFromCurrentScript(
  defaults: Partial<CacicUmamiTrackingConfig> = {},
): StopCacicUmamiTracking | null {
  const config = resolveConfigFromCurrentScript(defaults);
  return config ? startCacicUmamiTracking(config) : null;
}

export function unloadCacicUmamiTracking(config: Pick<CacicUmamiTrackingConfig, 'websiteId'>): void {
  if (!isBrowser() || !config.websiteId) {
    return;
  }

  document.getElementById(resolveScriptId(config, 'umami'))?.remove();
  document.getElementById(resolveScriptId(config, 'recorder'))?.remove();

  if (window.umami) {
    delete window.umami;
  }
}

async function requestTrackingCookieRefresh(
  accountApiBaseUrl = DEFAULT_ACCOUNT_API_BASE_URL,
): Promise<CacicTrackingSessionResponse | null> {
  try {
    const response = await fetch(resolveTrackingUrl(accountApiBaseUrl, 'session'), {
      credentials: 'include',
    });

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as CacicTrackingSessionResponse;
  } catch {
    return null;
  }
}

function resolveTrackingUrl(accountApiBaseUrl: string, route: keyof typeof CACIC_TRACKING_ROUTES): string {
  const origin = new URL(accountApiBaseUrl).origin;
  return new URL(CACIC_TRACKING_ROUTES[route], origin).toString();
}

function resolveConfigFromCurrentScript(defaults: Partial<CacicUmamiTrackingConfig>): CacicUmamiTrackingConfig | null {
  if (!isBrowser() || !(document.currentScript instanceof HTMLScriptElement)) {
    return null;
  }

  const { dataset } = document.currentScript;
  const websiteId = dataset['websiteId'] ?? defaults.websiteId;

  if (!websiteId) {
    return null;
  }

  return {
    ...defaults,
    autoTrack: resolveBooleanDatasetValue(dataset['autoTrack'], defaults.autoTrack),
    domains: resolveDomains(dataset['domains'], defaults.domains),
    recorder: resolveRecorderConfig(dataset, defaults.recorder),
    scriptSrc: dataset['scriptSrc'] ?? defaults.scriptSrc,
    trackPageView: resolveBooleanDatasetValue(dataset['trackPageView'], defaults.trackPageView),
    websiteId,
  };
}

function resolveBooleanDatasetValue(value: string | undefined, fallback: boolean | undefined): boolean | undefined {
  if (value === 'true') {
    return true;
  }

  if (value === 'false') {
    return false;
  }

  return fallback;
}

function resolveDomains(value: string | undefined, fallback: string[] | undefined): string[] | undefined {
  if (!value) {
    return fallback;
  }

  const domains = value
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean);

  return domains.length ? domains : fallback;
}

function resolveRecorderConfig(
  dataset: DOMStringMap,
  fallback: CacicUmamiRecorderConfig | undefined,
): CacicUmamiRecorderConfig | undefined {
  if (!dataset['recorderSrc'] && !dataset['sampleRate'] && !dataset['maskLevel'] && !dataset['maxDuration']) {
    return fallback;
  }

  return {
    ...fallback,
    maskLevel: resolveMaskLevel(dataset['maskLevel'], fallback?.maskLevel),
    maxDuration: resolveNumberDatasetValue(dataset['maxDuration'], fallback?.maxDuration),
    sampleRate: resolveNumberDatasetValue(dataset['sampleRate'], fallback?.sampleRate),
    src: dataset['recorderSrc'] ?? fallback?.src,
  };
}

function resolveNumberDatasetValue(value: string | undefined, fallback: number | undefined): number | undefined {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveMaskLevel(
  value: string | undefined,
  fallback: CacicUmamiRecorderConfig['maskLevel'],
): CacicUmamiRecorderConfig['maskLevel'] {
  return value === 'none' || value === 'light' || value === 'moderate' || value === 'strict' ? value : fallback;
}

function readCookie(name: string): string | null {
  const prefix = `${name}=`;
  const cookie = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  try {
    return decodeURIComponent(cookie.slice(prefix.length));
  } catch {
    return cookie.slice(prefix.length);
  }
}

function readConsentCookie(value: string | null): CacicAnalyticsConsentCookiePayload | null {
  if (!value) {
    return null;
  }

  try {
    const parsed = JSON.parse(value) as Partial<CacicAnalyticsConsentCookiePayload>;
    return typeof parsed.analyticsAllowed === 'boolean' &&
      typeof parsed.cookieBannerAccepted === 'boolean' &&
      typeof parsed.identityAvailable === 'boolean'
      ? {
          analyticsAllowed: parsed.analyticsAllowed,
          cookieBannerAccepted: parsed.cookieBannerAccepted,
          identityAvailable: parsed.identityAvailable,
          updatedAt: parsed.updatedAt ?? '',
          version: parsed.version ?? '',
        }
      : null;
  } catch {
    return null;
  }
}

function expireCookie(name: string, domain?: string): void {
  const domainPart = domain ? `; domain=${domain}` : '';
  document.cookie = `${name}=; Max-Age=0; path=/${domainPart}; SameSite=Lax`;
}

function resolveCurrentSharedCookieDomain(): string | undefined {
  const hostname = window.location.hostname;
  if (hostname === 'cacic.dev.br' || hostname.endsWith('.cacic.dev.br')) {
    return '.cacic.dev.br';
  }

  return undefined;
}

function loadUmamiScript(config: CacicUmamiTrackingConfig): Promise<boolean> {
  const existingScript = document.getElementById(resolveScriptId(config, 'umami'));
  if (existingScript) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    const script = document.createElement('script');
    script.id = resolveScriptId(config, 'umami');
    script.defer = true;
    script.src = config.scriptSrc ?? DEFAULT_UMAMI_SCRIPT_SRC;
    script.dataset['websiteId'] = config.websiteId;

    if (config.domains?.length) {
      script.dataset['domains'] = config.domains.join(',');
    }

    if (config.autoTrack === false) {
      script.dataset['autoTrack'] = 'false';
    }

    script.addEventListener('load', () => resolve(true), { once: true });
    script.addEventListener('error', () => resolve(false), { once: true });
    document.head.append(script);
  });
}

function loadRecorderScript(config: CacicUmamiTrackingConfig): void {
  if (!config.recorder || document.getElementById(resolveScriptId(config, 'recorder'))) {
    return;
  }

  const script = document.createElement('script');
  script.id = resolveScriptId(config, 'recorder');
  script.defer = true;
  script.src = config.recorder.src ?? 'https://a.cacic.dev.br/recorder.js';
  script.dataset['websiteId'] = config.websiteId;
  script.dataset['sampleRate'] = String(config.recorder.sampleRate ?? 1);
  script.dataset['maskLevel'] = config.recorder.maskLevel ?? 'moderate';
  script.dataset['maxDuration'] = String(config.recorder.maxDuration ?? 1_200_000);
  document.head.append(script);
}

function resolveScriptId(config: Pick<CacicUmamiTrackingConfig, 'websiteId'>, kind: 'recorder' | 'umami'): string {
  return `cacic-${kind}-${config.websiteId.replace(/[^a-z0-9_-]/gi, '-')}`;
}

function disabledResult(reason: CacicUmamiTrackingResult['reason']): CacicUmamiTrackingResult {
  return {
    analyticsAllowed: false,
    cookieBannerAccepted: false,
    isAnonymous: true,
    loaded: false,
    reason,
    userId: null,
  };
}

function isBrowser(): boolean {
  return typeof window !== 'undefined' && typeof document !== 'undefined';
}
