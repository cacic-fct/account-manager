import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { DiscordLink } from '@prisma/client';
import { DiscordClientService } from '../../../discord/services/discord-client.service';
import { DiscordManagedRoleOverridesService } from '../../../discord/services/discord-managed-role-overrides.service';
import { DiscordRoleService } from '../../../discord/services/discord-role.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccountPermissionService } from '../account-permission.service';
import { KeycloakService } from '../keycloak.service';
import { UserService } from '../user.service';
import * as schema from '../user-schema';

class TestKeycloakService extends KeycloakService {
  readonly request = jest.fn<Promise<Response>, [string, RequestInit?]>();

  override getAdminToken(): Promise<string> {
    return Promise.resolve('admin-token');
  }

  protected override fetchWithTimeout(url: string, options?: RequestInit): Promise<Response> {
    return this.request(url, options);
  }
}

describe('Keycloak onboarding reconciliation', () => {
  let service: TestKeycloakService;
  let attributes: Record<string, string[]>;
  let writes: Record<string, string[]>[];

  beforeEach(() => {
    jest.replaceProperty(schema, 'REQUIRED_ONBOARDING_SCHEMA_VERSION', 1);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    service = new TestKeycloakService();
    attributes = {
      isOnboarded: ['true'],
      fullName: ['User Test'],
      phone: ['+5514999999999'],
      'identity-document': ['12345678901'],
    };
    writes = [];
    service.request.mockImplementation((_url, options) => {
      if (options?.method === 'PUT') {
        const body = JSON.parse(options.body as string) as { attributes: Record<string, string[]> };
        attributes = body.attributes;
        writes.push(attributes);
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      return Promise.resolve(new Response(JSON.stringify({ id: 'user-1', attributes })));
    });
  });
  afterEach(() => jest.restoreAllMocks());

  it('resets the shared flag once without validating incomplete legacy data', async () => {
    delete attributes.phone;
    attributes.unrelated = ['preserved'];
    const listener = jest.fn<Promise<void>, [string]>().mockImplementation(async () => {
      // Reading again from a consumer must not deadlock inside the write queue.
      await service.reconcileUserOnboarding('user-1');
    });
    service.onUserUpdated(listener);

    const result = await service.reconcileUserOnboarding('user-1');
    await service.reconcileUserOnboarding('user-1');

    expect(result.isOnboarded).toEqual(['false']);
    expect(writes).toHaveLength(1);
    expect(writes[0].unrelated).toEqual(['preserved']);
    expect(writes[0].userSchemaVersion).toBeUndefined();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('rechecks inside the write queue after a concurrent profile completion', async () => {
    const save = service.updateUserAttributes('user-1', {
      isOnboarded: ['true'],
      userSchemaVersion: [String(schema.CURRENT_USER_SCHEMA_VERSION)],
    });
    const reconcile = service.reconcileUserOnboarding('user-1');
    await save;
    const result = await reconcile;

    expect(writes).toHaveLength(1);
    expect(result.isOnboarded).toEqual(['true']);
  });

  it('finishes a Discord role assignment and its follow-up sync when a profile read resets onboarding', async () => {
    attributes.email = ['user@example.com'];
    const link = {
      id: 'link-1',
      userId: 'user-1',
      discordId: 'discord-1',
      deleted: false,
      isVerified: true,
    } as DiscordLink;
    const updateLink = jest.fn().mockResolvedValue(link);
    const prisma = {
      discordLink: {
        findMany: jest.fn().mockResolvedValue([link]),
        update: updateLink,
      },
      user: { upsert: jest.fn().mockResolvedValue({}) },
    } as unknown as PrismaService;
    const users = new UserService(service, {} as AccountPermissionService, prisma);
    const roles = new DiscordRoleService(
      prisma,
      users,
      { getClient: () => null } as unknown as DiscordClientService,
      { get: () => undefined } as unknown as ConfigService,
      service,
      {
        getOverrideCategoryForUser: () => Promise.resolve(null),
      } as unknown as DiscordManagedRoleOverridesService,
    );
    jest.spyOn(service, 'isRealmReachable').mockResolvedValue(true);
    const followUpSync = jest.spyOn(roles, 'syncUserDiscordRoles');
    roles.onModuleInit();

    try {
      await roles.assignUserRole(link, { skipKeycloakHealthCheck: true });
      expect(followUpSync).toHaveBeenCalledWith('user-1', 'keycloak-user-updated');
      await expect(followUpSync.mock.results[0].value).resolves.toBeUndefined();

      expect(attributes.isOnboarded).toEqual(['false']);
      expect(writes).toHaveLength(1);
      expect(updateLink).toHaveBeenCalledTimes(2);
    } finally {
      roles.onModuleDestroy();
    }
  });

  it('does not report a successful reset when Keycloak rejects the write', async () => {
    service.request.mockImplementation((_url, options) =>
      Promise.resolve(
        options?.method === 'PUT'
          ? new Response('failed', { status: 500 })
          : new Response(JSON.stringify({ id: 'user-1', attributes })),
      ),
    );
    await expect(service.reconcileUserOnboarding('user-1')).rejects.toThrow();
  });

  it('lists full unfiltered pages and skips machine accounts without truncating pagination', async () => {
    service.request.mockResolvedValue(
      new Response(
        JSON.stringify([
          { id: 'user-1', attributes },
          { id: 'machine', serviceAccountClientId: 'm2m-client' },
        ]),
      ),
    );

    const page = await service.getOnboardingUserPage(100, 2);

    expect(page).toEqual({ users: [{ id: 'user-1', attributes }], hasMore: true });
    expect(service.request.mock.calls[0][0]).toContain('first=100&max=2&briefRepresentation=false');
    expect(service.request.mock.calls[0][0]).not.toContain('q=');
  });

  it.each([{}, [{ id: 12 }], [{ id: 'user-1', attributes: { isOnboarded: 'true' } }]])(
    'rejects malformed list responses',
    async (data) => {
      service.request.mockResolvedValue(new Response(JSON.stringify(data)));
      await expect(service.getOnboardingUserPage(0, 100)).rejects.toThrow();
    },
  );

  it('propagates listing failures for the scheduled retry', async () => {
    service.request.mockResolvedValue(new Response(null, { status: 503 }));
    await expect(service.getOnboardingUserPage(0, 100)).rejects.toThrow('503');
  });
});
