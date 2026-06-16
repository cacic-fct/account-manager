import { delay, http, HttpResponse } from 'msw';

import {
  mockDiscordStatusLinked,
  mockDiscordStatusNotLinked,
  mockAdminSelectableRoles,
  mockRoles,
  mockServerSettings,
  mockUserRoles,
  mockVerificationStatusApproved,
  mockVerificationStatusNotSubmitted,
  mockVerificationStatusPending,
  mockVerificationStatusRejected,
} from './component-mocks';

const API_BASE = '*/api';

export const authHandlers = {
  csrf: http.get(`${API_BASE}/csrf/token`, () =>
    HttpResponse.json({ csrfToken: 'storybook-csrf-token' }),
  ),
};

export const privacyHandlers = {
  directivesShowBanner: http.get(`${API_BASE}/privacy/directives`, () =>
    HttpResponse.json({
      directives: {
        cookieBanner: { type: 'ui', name: 'cookie-banner', action: 'show' },
        analyticsTracking: {
          type: 'data-handling',
          name: 'analytics-tracking',
          action: 'disable',
        },
        errorDebugging: {
          type: 'data-handling',
          name: 'error-debugging',
          action: 'disable',
        },
        performanceMonitoring: {
          type: 'data-handling',
          name: 'performance-monitoring',
          action: 'disable',
        },
      },
    }),
  ),
  acceptCookieBanner: http.post(`${API_BASE}/privacy/cookie-banner/accept`, () =>
    HttpResponse.json({ ok: true }),
  ),
};

export const profileHandlers = {
  shouldShowUnespRoleSelection: http.get(
    `${API_BASE}/auth/unesp-role-required`,
    () => HttpResponse.json({ shouldShowUnespRoleSelection: true }),
  ),
  shouldHideUnespRoleSelection: http.get(
    `${API_BASE}/auth/unesp-role-required`,
    () => HttpResponse.json({ shouldShowUnespRoleSelection: false }),
  ),
};

export const discordHandlers = {
  linked: http.get(`${API_BASE}/discord/status`, () =>
    HttpResponse.json(mockDiscordStatusLinked),
  ),
  notLinked: http.get(`${API_BASE}/discord/status`, () =>
    HttpResponse.json(mockDiscordStatusNotLinked),
  ),
  delayed: http.get(`${API_BASE}/discord/status`, async () => {
    await delay(1500);
    return HttpResponse.json(mockDiscordStatusLinked);
  }),
  error: http.get(`${API_BASE}/discord/status`, () =>
    HttpResponse.json(
      { message: 'Erro ao carregar status do Discord' },
      { status: 500 },
    ),
  ),
  selectableRoles: http.get(`${API_BASE}/discord/roles/selectable`, () =>
    HttpResponse.json(mockRoles.filter((role) => role.isEnabled && !role.isBlacklisted)),
  ),
  userRoles: http.get(`${API_BASE}/discord/roles/user`, () =>
    HttpResponse.json(mockUserRoles),
  ),
  updateUserRolesSuccess: http.put(`${API_BASE}/discord/roles/user`, async () => {
    await delay(600);
    return HttpResponse.json({
      message: 'Cargos atualizados com sucesso',
      updatedRoles: mockUserRoles.availableRoles,
    });
  }),
  updateUserRolesCooldown: http.put(`${API_BASE}/discord/roles/user`, () =>
    HttpResponse.json(
      {
        message: 'Too many attempts. Please wait 8s before trying again.',
        attempts: 3,
        cooldownSeconds: 8,
      },
      { status: 429 },
    ),
  ),
  adminStatus: http.get(`${API_BASE}/discord/admin/status`, () =>
    HttpResponse.json({ isAdmin: true }),
  ),
  adminStatusForbidden: http.get(`${API_BASE}/discord/admin/status`, () =>
    HttpResponse.json({ isAdmin: false }),
  ),
  adminStatusDelayed: http.get(`${API_BASE}/discord/admin/status`, async () => {
    await delay(1200);
    return HttpResponse.json({ isAdmin: true });
  }),
  serverSettings: http.get(`${API_BASE}/discord/admin/settings`, () =>
    HttpResponse.json(mockServerSettings),
  ),
  updateServerSettingSuccess: http.put(
    `${API_BASE}/discord/admin/settings/:key`,
    async ({ params, request }) => {
      const body = (await request.json()) as { value?: string };
      return HttpResponse.json({
        id: `setting_${String(params['key'])}`,
        key: String(params['key']),
        value: body.value ?? '',
        description: 'Configuração atualizada pelo Storybook',
        updatedAt: new Date('2026-06-16T12:00:00.000Z'),
      });
    },
  ),
  adminRoles: http.get(`${API_BASE}/discord/roles/admin`, () =>
    HttpResponse.json(mockAdminSelectableRoles),
  ),
  updateRoleSelectionSuccess: http.put(
    `${API_BASE}/discord/roles/admin/selection`,
    async () => {
      await delay(500);
      return HttpResponse.json({ message: 'Cargos atualizados com sucesso' });
    },
  ),
  syncRolesSuccess: http.post(`${API_BASE}/discord/roles/admin/sync`, async () => {
    await delay(500);
    return HttpResponse.json({ message: 'Cargos sincronizados com sucesso' });
  }),
};

export const studentVerificationHandlers = {
  statusNotSubmitted: http.get(`${API_BASE}/student-verification/status`, () =>
    HttpResponse.json(mockVerificationStatusNotSubmitted),
  ),
  statusPending: http.get(`${API_BASE}/student-verification/status`, () =>
    HttpResponse.json(mockVerificationStatusPending),
  ),
  statusApproved: http.get(`${API_BASE}/student-verification/status`, () =>
    HttpResponse.json(mockVerificationStatusApproved),
  ),
  statusRejected: http.get(`${API_BASE}/student-verification/status`, () =>
    HttpResponse.json(mockVerificationStatusRejected),
  ),
  statusError: http.get(`${API_BASE}/student-verification/status`, () =>
    HttpResponse.json({ message: 'Falha ao carregar status' }, { status: 500 }),
  ),
  uploadSuccess: http.post(`${API_BASE}/student-verification/upload`, async () => {
    await delay(700);
    return HttpResponse.json({
      message: 'Documento enviado com sucesso!',
      documentId: 'doc_1',
      status: 'pending',
    });
  }),
};

export const universityValidationHandlers = {
  atomicCaptcha: http.post(`${API_BASE}/university-validation/atomic-captcha`, () =>
    HttpResponse.json({
      captchaImage:
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iNTAiPjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNmMWYxZjEiLz48dGV4dCB4PSI3NSIgeT0iMzAiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkFCQzEyMzwvdGV4dD48L3N2Zz4=',
      sessionId: 'session_1',
    }),
  ),
  cooldownStatus: http.post(`${API_BASE}/university-validation/cooldown-status`, () =>
    HttpResponse.json({
      inCooldown: false,
      remainingSeconds: 0,
      attempts: 0,
      nextCooldownSeconds: 2,
    }),
  ),
  refreshCaptcha: http.post(`${API_BASE}/university-validation/refresh-captcha`, () =>
    HttpResponse.json({
      captchaImage:
        'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxNTAiIGhlaWdodD0iNTAiPjxyZWN0IHdpZHRoPSIxNTAiIGhlaWdodD0iNTAiIGZpbGw9IiNlOGY1ZTkiLz48dGV4dCB4PSI3NSIgeT0iMzAiIGZvbnQtc2l6ZT0iMjAiIHRleHQtYW5jaG9yPSJtaWRkbGUiPkRFRjQ1NjwvdGV4dD48L3N2Zz4=',
      sessionId: 'session_1',
    }),
  ),
  validateAtomic: http.post(`${API_BASE}/university-validation/validate-atomic`, () =>
    HttpResponse.json({
      success: true,
      valid: true,
      message: 'Documento válido',
      needsCaptcha: false,
    }),
  ),
};
