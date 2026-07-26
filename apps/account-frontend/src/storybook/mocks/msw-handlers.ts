import { delay, http, HttpResponse } from 'msw';

import {
  createMockKeycloakPermissionGrant,
  createMockDiscordManagedRoleOverride,
  createMockPermissionGroupRoleGrant,
  createMockStudentEntityMembership,
  mockDiscordManagedRoleCatalog,
  mockDiscordManagedRoleOverrides,
  mockDiscordStatusLinked,
  mockDiscordStatusNotLinked,
  mockDirectKeycloakPermissionGrant,
  mockAdminSelectableRoles,
  mockKeycloakPermissionCatalog,
  mockKeycloakPermissionUsers,
  mockPermissionGroupCatalog,
  mockPermissionGroupRoleGrants,
  mockRoles,
  mockServerSettings,
  mockStudentEntityMemberships,
  mockUserRoles,
  mockVerificationStatusApproved,
  mockVerificationStatusNotSubmitted,
  mockVerificationStatusPending,
  mockVerificationStatusRejected,
} from './component-mocks';
import {
  PermissionGroupKey,
  type DiscordManagedRoleCategory,
  type KeycloakPermissionUser,
  type KeycloakPermissionGrantCreateRequest,
  type DiscordManagedRoleOverrideCreateRequest,
  type DiscordManagedRoleOverrideUpdateRequest,
  type PermissionGroupMembershipCreateRequest,
  type PermissionGroupMembershipUpdateRequest,
  type PermissionGroupRoleGrantUpdateRequest,
  type AccountMergeRequest,
  type AccountMergeStatus,
} from '@cacic/shared-types';

const API_BASE = '*/api';

export type KeycloakPermissionsStoryState = {
  rosterMode: 'balanced' | 'empty' | 'large';
  searchMode: 'matches' | 'empty' | 'error';
  selfServiceMode: 'mixed' | 'empty' | 'groups-only' | 'grants-only';
  failureMode: 'none' | 'catalog' | 'save';
  responseDelayMs: number;
};

const defaultKeycloakPermissionsStoryState: KeycloakPermissionsStoryState = {
  rosterMode: 'balanced',
  searchMode: 'matches',
  selfServiceMode: 'mixed',
  failureMode: 'none',
  responseDelayMs: 0,
};

export type DiscordManagedRoleOverridesStoryState = {
  overrideMode: 'balanced' | 'empty' | 'dense';
  searchMode: 'matches' | 'empty' | 'error';
  failureMode: 'none' | 'catalog' | 'save' | 'delete';
  responseDelayMs: number;
};

export type AdminAccountMergesStoryState = {
  mergeState: 'selection' | 'pending' | 'pending_score' | 'processing' | 'pending_merge' | 'completed' | 'failed' | 'expired';
  searchMode: 'matches' | 'empty' | 'error';
  failureMode: 'none' | 'create' | 'confirm' | 'cancel';
  responseDelayMs: number;
};

const defaultDiscordManagedRoleOverridesStoryState: DiscordManagedRoleOverridesStoryState = {
  overrideMode: 'balanced',
  searchMode: 'matches',
  failureMode: 'none',
  responseDelayMs: 0,
};

const defaultAdminAccountMergesStoryState: AdminAccountMergesStoryState = {
  mergeState: 'selection',
  searchMode: 'matches',
  failureMode: 'none',
  responseDelayMs: 0,
};

let keycloakPermissionsStoryState = defaultKeycloakPermissionsStoryState;
let discordManagedRoleOverridesStoryState = defaultDiscordManagedRoleOverridesStoryState;
let adminAccountMergesStoryState = defaultAdminAccountMergesStoryState;

export const setKeycloakPermissionsStoryState = (state: Partial<KeycloakPermissionsStoryState>): void => {
  keycloakPermissionsStoryState = {
    ...defaultKeycloakPermissionsStoryState,
    ...state,
  };
};

export const setDiscordManagedRoleOverridesStoryState = (
  state: Partial<DiscordManagedRoleOverridesStoryState>,
): void => {
  discordManagedRoleOverridesStoryState = {
    ...defaultDiscordManagedRoleOverridesStoryState,
    ...state,
  };
};

export const setAdminAccountMergesStoryState = (state: Partial<AdminAccountMergesStoryState>): void => {
  adminAccountMergesStoryState = {
    ...defaultAdminAccountMergesStoryState,
    ...state,
  };
};

const delayForStory = async (): Promise<void> => {
  if (keycloakPermissionsStoryState.responseDelayMs > 0) {
    await delay(keycloakPermissionsStoryState.responseDelayMs);
  }
};

const delayForDiscordManagedRoleOverridesStory = async (): Promise<void> => {
  if (discordManagedRoleOverridesStoryState.responseDelayMs > 0) {
    await delay(discordManagedRoleOverridesStoryState.responseDelayMs);
  }
};

const delayForAdminAccountMergesStory = async (): Promise<void> => {
  if (adminAccountMergesStoryState.responseDelayMs > 0) {
    await delay(adminAccountMergesStoryState.responseDelayMs);
  }
};

const getMembershipsForRoster = (groupKey: PermissionGroupKey) => {
  if (keycloakPermissionsStoryState.rosterMode === 'empty') {
    return [];
  }

  const memberships = mockStudentEntityMemberships.filter((membership) => membership.groupKey === groupKey);

  if (keycloakPermissionsStoryState.rosterMode !== 'large') {
    return memberships;
  }

  const extraMembers = mockKeycloakPermissionUsers
    .slice(5)
    .map((user, index) => createMockStudentEntityMembership(user, groupKey, index + memberships.length + 1));

  return [...memberships, ...extraMembers];
};

const getUserMemberships = (userId: string) =>
  mockStudentEntityMemberships.filter((membership) => membership.userId === userId);

const getUserGrants = (userId: string) => {
  if (userId === mockKeycloakPermissionUsers[0]?.id) {
    return [mockDirectKeycloakPermissionGrant];
  }

  return [];
};

const searchPermissionUsers = (users: KeycloakPermissionUser[], query: string) => {
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

const getDiscordManagedRoleOverrides = () => {
  if (discordManagedRoleOverridesStoryState.overrideMode === 'empty') {
    return [];
  }

  if (discordManagedRoleOverridesStoryState.overrideMode !== 'dense') {
    return mockDiscordManagedRoleOverrides;
  }

  const extraOverrides = mockKeycloakPermissionUsers.slice(3).map((user, index) => {
    const categories: DiscordManagedRoleCategory[] = ['student', 'unesp', 'visitor'];
    const category = categories[index % categories.length] ?? 'visitor';
    return createMockDiscordManagedRoleOverride(user, category, index + mockDiscordManagedRoleOverrides.length);
  });

  return [...mockDiscordManagedRoleOverrides, ...extraOverrides];
};

const getAdminAccountMergeRequest = (): AccountMergeRequest => {
  const [firstUser, secondUser] = mockKeycloakPermissionUsers;
  const status = adminAccountMergesStoryState.mergeState as AccountMergeStatus;
  const isPending = status === 'pending';
  const hasScores = ['pending_score', 'processing', 'pending_merge', 'completed', 'failed', 'expired'].includes(status);
  const primaryEmail = firstUser?.email ?? 'conta-principal@example.com';
  const secondaryEmail = secondUser?.email ?? 'conta-secundaria@example.com';

  return {
    id: 'storybook-account-merge-1',
    status,
    requesterUserId: firstUser?.id ?? 'storybook-account-1',
    candidateUserId: secondUser?.id ?? 'storybook-account-2',
    primaryUserId: firstUser?.id ?? 'storybook-account-1',
    secondaryUserId: secondUser?.id ?? 'storybook-account-2',
    primaryEmailOptions: [primaryEmail, secondaryEmail],
    selectedPrimaryEmail: isPending ? undefined : primaryEmail,
    secondaryEmails: isPending ? [] : [secondaryEmail],
    notificationSummary:
      status === 'pending_merge'
        ? { pending: 2, completed: 1, failed: 0 }
        : { pending: 0, completed: status === 'completed' ? 3 : 0, failed: status === 'failed' ? 1 : 0 },
    scores: hasScores
      ? [
          {
            userId: firstUser?.id ?? 'storybook-account-1',
            email: primaryEmail,
            displayName: firstUser?.displayName ?? 'Conta principal',
            score: 86,
            contributions: [
              { source: 'CACiC', label: 'Cadastro completo', points: 25 },
              { source: 'CACiC', label: 'Vínculo estudantil validado', points: 30 },
              { source: 'CACiC', label: 'Conta Discord verificada', points: 15 },
              { source: 'CACiC', label: 'Perfil consolidado', points: 16 },
            ],
          },
          {
            userId: secondUser?.id ?? 'storybook-account-2',
            email: secondaryEmail,
            displayName: secondUser?.displayName ?? 'Conta secundária',
            score: 43,
            contributions: [
              { source: 'CACiC', label: 'Cadastro parcial', points: 15 },
              { source: 'CACiC', label: 'Conta Discord verificada', points: 15 },
              { source: 'CACiC', label: 'Perfil com foto', points: 5 },
              { source: 'CACiC', label: 'Conta estabelecida', points: 8 },
            ],
          },
        ]
      : [],
    externalScores: [],
    expiresAt: '2026-07-24T12:00:00.000Z',
    completedAt: status === 'completed' ? '2026-07-23T13:05:00.000Z' : undefined,
    createdAt: '2026-07-23T12:00:00.000Z',
  };
};

export const authHandlers = {
  csrf: http.get(`${API_BASE}/csrf/token`, () => HttpResponse.json({ csrfToken: 'storybook-csrf-token' })),
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
  acceptCookieBanner: http.post(`${API_BASE}/privacy/cookie-banner/accept`, () => HttpResponse.json({ ok: true })),
};

export const profileHandlers = {
  shouldShowUnespRoleSelection: http.get(`${API_BASE}/auth/unesp-role-required`, () =>
    HttpResponse.json({ shouldShowUnespRoleSelection: true }),
  ),
  shouldHideUnespRoleSelection: http.get(`${API_BASE}/auth/unesp-role-required`, () =>
    HttpResponse.json({ shouldShowUnespRoleSelection: false }),
  ),
};

export const discordHandlers = {
  linked: http.get(`${API_BASE}/discord/status`, () => HttpResponse.json(mockDiscordStatusLinked)),
  notLinked: http.get(`${API_BASE}/discord/status`, () => HttpResponse.json(mockDiscordStatusNotLinked)),
  delayed: http.get(`${API_BASE}/discord/status`, async () => {
    await delay(1500);
    return HttpResponse.json(mockDiscordStatusLinked);
  }),
  error: http.get(`${API_BASE}/discord/status`, () =>
    HttpResponse.json({ message: 'Erro ao carregar status do Discord' }, { status: 500 }),
  ),
  selectableRoles: http.get(`${API_BASE}/discord/roles/selectable`, () =>
    HttpResponse.json(mockRoles.filter((role) => role.isEnabled && !role.isBlacklisted)),
  ),
  userRoles: http.get(`${API_BASE}/discord/roles/user`, () => HttpResponse.json(mockUserRoles)),
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
  adminStatus: http.get(`${API_BASE}/discord/admin/status`, () => HttpResponse.json({ isAdmin: true })),
  adminStatusForbidden: http.get(`${API_BASE}/discord/admin/status`, () => HttpResponse.json({ isAdmin: false })),
  adminStatusDelayed: http.get(`${API_BASE}/discord/admin/status`, async () => {
    await delay(1200);
    return HttpResponse.json({ isAdmin: true });
  }),
  serverSettings: http.get(`${API_BASE}/discord/admin/settings`, () => HttpResponse.json(mockServerSettings)),
  updateServerSettingSuccess: http.put(`${API_BASE}/discord/admin/settings/:key`, async ({ params, request }) => {
    const body = (await request.json()) as { value?: string };
    return HttpResponse.json({
      id: `setting_${String(params['key'])}`,
      key: String(params['key']),
      value: body.value ?? '',
      description: 'Configuração atualizada pelo Storybook',
      updatedAt: new Date('2026-06-16T12:00:00.000Z'),
    });
  }),
  adminRoles: http.get(`${API_BASE}/discord/roles/admin`, () => HttpResponse.json(mockAdminSelectableRoles)),
  updateRoleSelectionSuccess: http.put(`${API_BASE}/discord/roles/admin/selection`, async () => {
    await delay(500);
    return HttpResponse.json({ message: 'Cargos atualizados com sucesso' });
  }),
  syncRolesSuccess: http.post(`${API_BASE}/discord/roles/admin/sync`, async () => {
    await delay(500);
    return HttpResponse.json({ message: 'Cargos sincronizados com sucesso' });
  }),
};

export const discordManagedRoleOverrideHandlers = [
  http.get(`${API_BASE}/discord/roles/admin/managed-role-overrides/catalog`, async () => {
    await delayForDiscordManagedRoleOverridesStory();
    if (discordManagedRoleOverridesStoryState.failureMode === 'catalog') {
      return HttpResponse.json({ message: 'Falha ao carregar catalogo de cargos gerenciados' }, { status: 500 });
    }

    return HttpResponse.json(mockDiscordManagedRoleCatalog);
  }),
  http.get(`${API_BASE}/discord/roles/admin/managed-role-overrides`, async () => {
    await delayForDiscordManagedRoleOverridesStory();
    return HttpResponse.json(getDiscordManagedRoleOverrides());
  }),
  http.get(`${API_BASE}/admin/permissions/users`, async ({ request }) => {
    await delayForDiscordManagedRoleOverridesStory();
    if (discordManagedRoleOverridesStoryState.searchMode === 'error') {
      return HttpResponse.json({ message: 'Falha ao buscar usuarios' }, { status: 500 });
    }

    if (discordManagedRoleOverridesStoryState.searchMode === 'empty') {
      return HttpResponse.json([]);
    }

    const query = new URL(request.url).searchParams.get('query') ?? '';
    return HttpResponse.json(searchPermissionUsers(mockKeycloakPermissionUsers, query));
  }),
  http.post(`${API_BASE}/discord/roles/admin/managed-role-overrides`, async ({ request }) => {
    await delayForDiscordManagedRoleOverridesStory();
    if (discordManagedRoleOverridesStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao criar excecao de cargo' }, { status: 500 });
    }

    const body = (await request.json()) as DiscordManagedRoleOverrideCreateRequest;
    const user =
      mockKeycloakPermissionUsers.find((candidate) => candidate.id === body.userId) ?? mockKeycloakPermissionUsers[0];

    return HttpResponse.json(
      createMockDiscordManagedRoleOverride(
        user,
        body.roleCategory,
        getDiscordManagedRoleOverrides().length + 1,
        body.reason,
      ),
    );
  }),
  http.put(`${API_BASE}/discord/roles/admin/managed-role-overrides/:id`, async ({ params, request }) => {
    await delayForDiscordManagedRoleOverridesStory();
    if (discordManagedRoleOverridesStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao salvar excecao de cargo' }, { status: 500 });
    }

    const body = (await request.json()) as DiscordManagedRoleOverrideUpdateRequest;
    const existingOverride =
      getDiscordManagedRoleOverrides().find((override) => override.id === params['id']) ??
      mockDiscordManagedRoleOverrides[0];
    const user =
      mockKeycloakPermissionUsers.find((candidate) => candidate.id === existingOverride.userId) ??
      mockKeycloakPermissionUsers[0];

    return HttpResponse.json(
      createMockDiscordManagedRoleOverride(
        user,
        body.roleCategory ?? existingOverride.roleCategory,
        getDiscordManagedRoleOverrides().length + 2,
        body.reason ?? existingOverride.reason,
      ),
    );
  }),
  http.delete(`${API_BASE}/discord/roles/admin/managed-role-overrides/:id`, async ({ params }) => {
    await delayForDiscordManagedRoleOverridesStory();
    if (discordManagedRoleOverridesStoryState.failureMode === 'delete') {
      return HttpResponse.json({ message: 'Falha ao remover excecao de cargo' }, { status: 500 });
    }

    const existingOverride =
      getDiscordManagedRoleOverrides().find((override) => override.id === params['id']) ??
      mockDiscordManagedRoleOverrides[0];

    return HttpResponse.json({ deleted: true, id: String(params['id']), userId: existingOverride.userId });
  }),
];

export const adminAccountMergeHandlers = [
  http.get(`${API_BASE}/admin/permissions/users`, async ({ request }) => {
    await delayForAdminAccountMergesStory();
    if (adminAccountMergesStoryState.searchMode === 'error') {
      return HttpResponse.json({ message: 'Falha ao buscar contas no Keycloak' }, { status: 500 });
    }

    if (adminAccountMergesStoryState.searchMode === 'empty') {
      return HttpResponse.json([]);
    }

    const query = new URL(request.url).searchParams.get('query') ?? '';
    return HttpResponse.json(searchPermissionUsers(mockKeycloakPermissionUsers, query));
  }),
  http.post(`${API_BASE}/admin/account-merges`, async () => {
    await delayForAdminAccountMergesStory();
    if (adminAccountMergesStoryState.failureMode === 'create') {
      return HttpResponse.json({ message: 'Não foi possível preparar a unificação' }, { status: 500 });
    }

    return HttpResponse.json({ ...getAdminAccountMergeRequest(), status: 'pending' });
  }),
  http.get(`${API_BASE}/admin/account-merges/:id`, async () => {
    await delayForAdminAccountMergesStory();
    return HttpResponse.json(getAdminAccountMergeRequest());
  }),
  http.post(`${API_BASE}/admin/account-merges/:id/confirm`, async () => {
    await delayForAdminAccountMergesStory();
    if (adminAccountMergesStoryState.failureMode === 'confirm') {
      return HttpResponse.json({ message: 'Não foi possível confirmar a unificação' }, { status: 500 });
    }

    if (adminAccountMergesStoryState.mergeState === 'selection') {
      adminAccountMergesStoryState = { ...adminAccountMergesStoryState, mergeState: 'pending_score' };
    }

    const request = getAdminAccountMergeRequest();
    return HttpResponse.json({
      request,
      primaryUserId: request.primaryUserId,
      mergedUserId: request.secondaryUserId,
      primaryEmail: request.selectedPrimaryEmail ?? request.primaryEmailOptions[0],
      secondaryEmails: request.secondaryEmails,
    });
  }),
  http.post(`${API_BASE}/admin/account-merges/:id/cancel`, async () => {
    await delayForAdminAccountMergesStory();
    if (adminAccountMergesStoryState.failureMode === 'cancel') {
      return HttpResponse.json({ message: 'Não foi possível cancelar a unificação' }, { status: 500 });
    }

    return HttpResponse.json({ success: true });
  }),
];

export const keycloakPermissionHandlers = [
  http.get(`${API_BASE}/admin/permissions/catalog`, async () => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'catalog') {
      return HttpResponse.json({ message: 'Falha ao carregar catalogo de permissoes' }, { status: 500 });
    }

    return HttpResponse.json(mockKeycloakPermissionCatalog);
  }),
  http.get(`${API_BASE}/admin/permissions/groups/catalog`, async () => {
    await delayForStory();
    return HttpResponse.json(mockPermissionGroupCatalog);
  }),
  http.get(`${API_BASE}/admin/permissions/groups/:groupKey/role-grants`, async ({ params }) => {
    await delayForStory();
    const groupKey = String(params['groupKey']) as PermissionGroupKey;
    return HttpResponse.json(mockPermissionGroupRoleGrants.filter((grant) => grant.groupKey === groupKey));
  }),
  http.put(`${API_BASE}/admin/permissions/groups/:groupKey/role-grants`, async ({ params, request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao salvar permissoes do grupo' }, { status: 500 });
    }

    const groupKey = String(params['groupKey']) as PermissionGroupKey;
    const body = (await request.json()) as PermissionGroupRoleGrantUpdateRequest;
    return HttpResponse.json(
      body.permissions.map((permission, index) => createMockPermissionGroupRoleGrant(groupKey, permission, index + 10)),
    );
  }),
  http.get(`${API_BASE}/admin/permissions/users`, async ({ request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.searchMode === 'error') {
      return HttpResponse.json({ message: 'Falha ao buscar usuarios' }, { status: 500 });
    }

    if (keycloakPermissionsStoryState.searchMode === 'empty') {
      return HttpResponse.json([]);
    }

    const query = new URL(request.url).searchParams.get('query') ?? '';
    return HttpResponse.json(searchPermissionUsers(mockKeycloakPermissionUsers, query));
  }),
  http.get(`${API_BASE}/admin/permissions/users/:userId/grants`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json(getUserGrants(String(params['userId'])));
  }),
  http.get(`${API_BASE}/admin/permissions/users/:userId/group-memberships`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json(getUserMemberships(String(params['userId'])));
  }),
  http.get(`${API_BASE}/admin/permissions/groups/memberships`, async ({ request }) => {
    await delayForStory();
    const groupKey =
      (new URL(request.url).searchParams.get('groupKey') as PermissionGroupKey) ?? PermissionGroupKey.Cacic;

    return HttpResponse.json(getMembershipsForRoster(groupKey));
  }),
  http.post(`${API_BASE}/admin/permissions/grants`, async ({ request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao conceder permissao' }, { status: 500 });
    }

    const body = (await request.json()) as KeycloakPermissionGrantCreateRequest;
    const user =
      mockKeycloakPermissionUsers.find((candidate) => candidate.id === body.userId) ?? mockKeycloakPermissionUsers[0];

    return HttpResponse.json(
      createMockKeycloakPermissionGrant(user, body.permission, 20, {
        validFrom: body.validFrom ? new Date(body.validFrom) : null,
        validUntil: body.validUntil ? new Date(body.validUntil) : null,
      }),
    );
  }),
  http.post(`${API_BASE}/admin/permissions/groups/memberships`, async ({ request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao salvar vinculo' }, { status: 500 });
    }

    const body = (await request.json()) as PermissionGroupMembershipCreateRequest;
    const user =
      mockKeycloakPermissionUsers.find((candidate) => candidate.id === body.userId) ?? mockKeycloakPermissionUsers[0];

    return HttpResponse.json({
      ...createMockStudentEntityMembership(user, body.groupKey, 16),
      validFrom: body.validFrom,
      validUntil: body.validUntil ?? null,
    });
  }),
  http.put(`${API_BASE}/admin/permissions/groups/memberships/:id`, async ({ params, request }) => {
    await delayForStory();
    if (keycloakPermissionsStoryState.failureMode === 'save') {
      return HttpResponse.json({ message: 'Falha ao salvar vinculo' }, { status: 500 });
    }

    const body = (await request.json()) as PermissionGroupMembershipUpdateRequest;
    const existingMembership =
      mockStudentEntityMemberships.find((membership) => membership.id === params['id']) ??
      mockStudentEntityMemberships[0];
    const user =
      mockKeycloakPermissionUsers.find((candidate) => candidate.id === existingMembership.userId) ??
      mockKeycloakPermissionUsers[0];

    return HttpResponse.json({
      ...createMockStudentEntityMembership(user, existingMembership.groupKey, 17),
      id: String(params['id']),
      validFrom: body.validFrom,
      validUntil: body.validUntil ?? null,
    });
  }),
  http.put(`${API_BASE}/admin/permissions/grants/:id`, async () => {
    await delayForStory();
    return HttpResponse.json(mockDirectKeycloakPermissionGrant);
  }),
  http.delete(`${API_BASE}/admin/permissions/grants/:id`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json({ deleted: true, id: String(params['id']) });
  }),
  http.delete(`${API_BASE}/admin/permissions/groups/memberships/:id`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json({ deleted: true, id: String(params['id']) });
  }),
  http.post(`${API_BASE}/admin/permissions/sync`, async () => {
    await delayForStory();
    return HttpResponse.json({ queued: true });
  }),
  http.get(`${API_BASE}/permissions/me`, async () => {
    await delayForStory();
    const memberships = getUserMemberships(mockKeycloakPermissionUsers[0].id);
    const grants = getUserGrants(mockKeycloakPermissionUsers[0].id);

    if (keycloakPermissionsStoryState.selfServiceMode === 'empty') {
      return HttpResponse.json({ memberships: [], grants: [] });
    }

    if (keycloakPermissionsStoryState.selfServiceMode === 'groups-only') {
      return HttpResponse.json({ memberships, grants: [] });
    }

    if (keycloakPermissionsStoryState.selfServiceMode === 'grants-only') {
      return HttpResponse.json({ memberships: [], grants });
    }

    return HttpResponse.json({
      memberships,
      grants,
    });
  }),
  http.delete(`${API_BASE}/permissions/me/groups/:id`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json({ removed: true, id: String(params['id']) });
  }),
  http.delete(`${API_BASE}/permissions/me/grants/:id`, async ({ params }) => {
    await delayForStory();
    return HttpResponse.json({ removed: true, id: String(params['id']) });
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
