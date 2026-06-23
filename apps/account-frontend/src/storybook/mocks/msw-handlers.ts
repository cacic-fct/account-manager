import { delay, http, HttpResponse } from 'msw';

import {
  createMockKeycloakPermissionGrant,
  createMockStudentEntityMembership,
  mockDiscordStatusLinked,
  mockDiscordStatusNotLinked,
  mockDirectKeycloakPermissionGrant,
  mockAdminSelectableRoles,
  mockKeycloakPermissionCatalog,
  mockKeycloakPermissionUsers,
  mockRoles,
  mockServerSettings,
  mockStudentEntityCatalog,
  mockStudentEntityMemberships,
  mockUserRoles,
  mockVerificationStatusApproved,
  mockVerificationStatusNotSubmitted,
  mockVerificationStatusPending,
  mockVerificationStatusRejected,
} from './component-mocks';
import {
  AssignableKeycloakPermission,
  StudentEntityKey,
  type KeycloakPermissionUser,
  type StudentEntityMembershipCreateRequest,
  type StudentEntityMembershipUpdateRequest,
} from '@cacic/shared-types';

const API_BASE = '*/api';

export type KeycloakPermissionsStoryState = {
  rosterMode: 'balanced' | 'empty' | 'large';
  searchMode: 'matches' | 'empty' | 'error';
  failureMode: 'none' | 'catalog' | 'save';
  responseDelayMs: number;
};

const defaultKeycloakPermissionsStoryState: KeycloakPermissionsStoryState = {
  rosterMode: 'balanced',
  searchMode: 'matches',
  failureMode: 'none',
  responseDelayMs: 0,
};

let keycloakPermissionsStoryState = defaultKeycloakPermissionsStoryState;

export const setKeycloakPermissionsStoryState = (
  state: Partial<KeycloakPermissionsStoryState>,
): void => {
  keycloakPermissionsStoryState = {
    ...defaultKeycloakPermissionsStoryState,
    ...state,
  };
};

const delayForStory = async (): Promise<void> => {
  if (keycloakPermissionsStoryState.responseDelayMs > 0) {
    await delay(keycloakPermissionsStoryState.responseDelayMs);
  }
};

const getMembershipsForRoster = (entity: StudentEntityKey) => {
  if (keycloakPermissionsStoryState.rosterMode === 'empty') {
    return [];
  }

  const memberships = mockStudentEntityMemberships.filter(
    (membership) => membership.entity === entity,
  );

  if (keycloakPermissionsStoryState.rosterMode !== 'large') {
    return memberships;
  }

  const extraMembers = mockKeycloakPermissionUsers
    .slice(5)
    .map((user, index) =>
      createMockStudentEntityMembership(
        user,
        entity,
        index + memberships.length + 1,
        [AssignableKeycloakPermission.AccountManagerAccess],
      ),
    );

  return [...memberships, ...extraMembers];
};

const getUserMemberships = (userId: string) =>
  mockStudentEntityMemberships.filter(
    (membership) => membership.userId === userId,
  );

const getUserGrants = (userId: string) => {
  const membershipGrants = getUserMemberships(userId).flatMap(
    (membership) => membership.permissionGrants,
  );

  if (userId === mockKeycloakPermissionUsers[0]?.id) {
    return [mockDirectKeycloakPermissionGrant, ...membershipGrants];
  }

  return membershipGrants;
};

const searchPermissionUsers = (
  users: KeycloakPermissionUser[],
  query: string,
) => {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return users;
  }

  return users.filter((user) =>
    [user.displayName, user.email, user.identityDocument, user.username]
      .filter(Boolean)
      .some((value) => value?.toLowerCase().includes(normalizedQuery)),
  );
};

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

export const keycloakPermissionHandlers = [
  http.get(`${API_BASE}/admin/permissions/catalog`, async () => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'catalog') {
      return HttpResponse.json(
        { message: 'Falha ao carregar catalogo de permissoes' },
        { status: 500 },
      );
    }

    return HttpResponse.json(mockKeycloakPermissionCatalog);
  }),
  http.get(
    `${API_BASE}/admin/permissions/student-entities/catalog`,
    async () => {
      await delayForStory();
      return HttpResponse.json(mockStudentEntityCatalog);
    },
  ),
  http.get(`${API_BASE}/admin/permissions/users`, async ({ request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.searchMode === 'error') {
      return HttpResponse.json(
        { message: 'Falha ao buscar usuarios' },
        { status: 500 },
      );
    }

    if (keycloakPermissionsStoryState.searchMode === 'empty') {
      return HttpResponse.json([]);
    }

    const query = new URL(request.url).searchParams.get('query') ?? '';
    return HttpResponse.json(
      searchPermissionUsers(mockKeycloakPermissionUsers, query),
    );
  }),
  http.get(
    `${API_BASE}/admin/permissions/users/:userId/grants`,
    async ({ params }) => {
      await delayForStory();
      return HttpResponse.json(getUserGrants(String(params['userId'])));
    },
  ),
  http.get(
    `${API_BASE}/admin/permissions/users/:userId/student-entity-memberships`,
    async ({ params }) => {
      await delayForStory();
      return HttpResponse.json(getUserMemberships(String(params['userId'])));
    },
  ),
  http.get(
    `${API_BASE}/admin/permissions/student-entities/memberships`,
    async ({ request }) => {
      await delayForStory();
      const entity =
        (new URL(request.url).searchParams.get('entity') as StudentEntityKey) ??
        StudentEntityKey.Cacic;

      return HttpResponse.json(getMembershipsForRoster(entity));
    },
  ),
  http.post(`${API_BASE}/admin/permissions/grants`, async ({ request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'save') {
      return HttpResponse.json(
        { message: 'Falha ao conceder permissao' },
        { status: 500 },
      );
    }

    const body = (await request.json()) as {
      userId: string;
      permission: AssignableKeycloakPermission;
      validFrom?: string | null;
      validUntil?: string | null;
    };
    const user =
      mockKeycloakPermissionUsers.find(
        (candidate) => candidate.id === body.userId,
      ) ?? mockKeycloakPermissionUsers[0];

    return HttpResponse.json(
      createMockKeycloakPermissionGrant(user, body.permission, 20, {
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      }),
    );
  }),
  http.post(
    `${API_BASE}/admin/permissions/student-entities/memberships`,
    async ({ request }) => {
      await delayForStory();
      if (keycloakPermissionsStoryState.failureMode === 'save') {
        return HttpResponse.json(
          { message: 'Falha ao salvar mandato' },
          { status: 500 },
        );
      }

      const body = (await request.json()) as StudentEntityMembershipCreateRequest;
      const user =
        mockKeycloakPermissionUsers.find(
          (candidate) => candidate.id === body.userId,
        ) ?? mockKeycloakPermissionUsers[0];

      return HttpResponse.json(
        createMockStudentEntityMembership(
          user,
          body.entity,
          16,
          body.permissions,
        ),
      );
    },
  ),
  http.put(
    `${API_BASE}/admin/permissions/student-entities/memberships/:id`,
    async ({ params, request }) => {
      await delayForStory();
      if (keycloakPermissionsStoryState.failureMode === 'save') {
        return HttpResponse.json(
          { message: 'Falha ao salvar mandato' },
          { status: 500 },
        );
      }

      const body = (await request.json()) as StudentEntityMembershipUpdateRequest;
      const existingMembership =
        mockStudentEntityMemberships.find(
          (membership) => membership.id === params['id'],
        ) ?? mockStudentEntityMemberships[0];
      const user =
        mockKeycloakPermissionUsers.find(
          (candidate) => candidate.id === existingMembership.userId,
        ) ?? mockKeycloakPermissionUsers[0];

      return HttpResponse.json({
        ...createMockStudentEntityMembership(
          user,
          existingMembership.entity,
          17,
          body.permissions,
        ),
        id: String(params['id']),
        mandateStart: body.mandateStart,
        mandateEnd: body.mandateEnd,
      });
    },
  ),
  http.put(`${API_BASE}/admin/permissions/grants/:id`, async () => {
    await delayForStory();
    return HttpResponse.json(mockDirectKeycloakPermissionGrant);
  }),
  http.delete(`${API_BASE}/admin/permissions/grants/:id`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json({ deleted: true, id: String(params['id']) });
  }),
  http.delete(
    `${API_BASE}/admin/permissions/student-entities/memberships/:id`,
    async ({ params }) => {
      await delayForStory();
      return HttpResponse.json({ deleted: true, id: String(params['id']) });
    },
  ),
  http.post(`${API_BASE}/admin/permissions/sync`, async () => {
    await delayForStory();
    return HttpResponse.json({ queued: true });
  }),
];

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
