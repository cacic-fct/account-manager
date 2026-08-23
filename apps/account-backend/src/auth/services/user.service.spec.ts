import { KeycloakConnectionException } from '../exceptions/keycloak-connection.exception';
import { AccountPermissionService } from './account-permission.service';
import { KeycloakService } from './keycloak.service';
import { UserService } from './user.service';

describe(UserService.name, () => {
  const keycloak = {
    getUserBasicInfo: jest.fn(),
    getUserAttributes: jest.fn(),
    getUserGroups: jest.fn().mockResolvedValue([]),
    updateUserAttributes: jest.fn(),
    findUserByEmail: jest.fn(),
  };
  const permissions = {} as AccountPermissionService;
  const prisma = {
    user: {
      upsert: jest.fn().mockResolvedValue({}),
    },
  };
  let service: UserService;

  beforeEach(() => {
    jest.clearAllMocks();
    keycloak.getUserGroups.mockResolvedValue([]);
    prisma.user.upsert.mockResolvedValue({});
    service = new UserService(keycloak as unknown as KeycloakService, permissions, prisma as never);
  });

  it('persists and returns passport country during foreign-user onboarding', async () => {
    keycloak.getUserBasicInfo.mockResolvedValue({ id: 'user-1', email: 'foreign@example.test' });
    keycloak.getUserAttributes.mockResolvedValue({
      email: ['foreign@example.test'],
      username: ['foreign@example.test'],
      displayName: ['Foreign User'],
      createdAt: ['2026-08-23T12:00:00.000Z'],
    });
    keycloak.updateUserAttributes.mockResolvedValue(undefined);

    const profile = await service.updateProfile('user-1', {
      fullname: 'Foreign User',
      phone: '+5514999999999',
      identityDocument: 'P1234567',
      isForeigner: true,
      passportCountry: 'AR',
    });

    expect(keycloak.updateUserAttributes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        isForeigner: ['true'],
        passportCountry: ['AR'],
      }),
    );
    expect(profile.passportCountry).toBe('AR');
  });

  it('propagates Keycloak outages instead of reporting an absent user', async () => {
    const outage = new KeycloakConnectionException('Keycloak unavailable');
    keycloak.getUserBasicInfo.mockRejectedValue(outage);

    await expect(service.findByKeycloakId('user-1')).rejects.toBe(outage);
  });

  it('does not report completed user creation when mandatory attributes fail to persist', async () => {
    keycloak.getUserBasicInfo.mockResolvedValue(null);
    keycloak.updateUserAttributes.mockRejectedValue(new Error('write failed'));

    await expect(
      service.createFromKeycloak({
        sub: 'user-1',
        email: 'user@example.test',
        email_verified: true,
        name: 'User Test',
        preferred_username: 'user',
        given_name: 'User',
        family_name: 'Test',
      }),
    ).rejects.toThrow('write failed');
    expect(prisma.user.upsert).not.toHaveBeenCalled();
  });
});
