import { KeycloakConnectionException } from '../exceptions/keycloak-connection.exception';
import { AccountPermissionService } from './account-permission.service';
import { KeycloakService } from './keycloak.service';
import { UserService } from './user.service';
import { CURRENT_USER_SCHEMA_VERSION } from './user-schema';

describe(UserService.name, () => {
  const keycloak = {
    getUserBasicInfo: jest.fn(),
    getUserAttributes: jest.fn<Promise<Record<string, string[]>>, [string]>(),
    reconcileUserOnboarding: jest.fn(),
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
    keycloak.reconcileUserOnboarding.mockImplementation((userId: string) => keycloak.getUserAttributes(userId));
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
        isOnboarded: ['true'],
        userSchemaVersion: [String(CURRENT_USER_SCHEMA_VERSION)],
      }),
    );
    expect(profile.passportCountry).toBe('AR');
    expect(profile.isOnboarded).toBe(true);
  });

  it('propagates Keycloak outages instead of reporting an absent user', async () => {
    const outage = new KeycloakConnectionException('Keycloak unavailable');
    keycloak.getUserBasicInfo.mockRejectedValue(outage);

    await expect(service.findByKeycloakId('user-1')).rejects.toBe(outage);
  });

  it('lets a returning user complement a missing identity document without changing their registered name', async () => {
    keycloak.getUserBasicInfo.mockResolvedValue({ id: 'user-1', email: 'user@example.test' });
    keycloak.getUserAttributes.mockResolvedValue({ fullName: ['User Test'], isOnboarded: ['false'] });
    keycloak.updateUserAttributes.mockResolvedValue(undefined);

    const profile = await service.updateProfile('user-1', {
      fullname: 'User Test',
      phone: '+5514999999999',
      identityDocument: '12345678901',
      isForeigner: false,
    });

    expect(profile.isOnboarded).toBe(true);
    expect(keycloak.updateUserAttributes).toHaveBeenCalledWith(
      'user-1',
      expect.objectContaining({
        fullName: ['User Test'],
        'identity-document': ['12345678901'],
        userSchemaVersion: [String(CURRENT_USER_SCHEMA_VERSION)],
        isOnboarded: ['true'],
      }),
    );
  });

  it('allows an Unesp user with an empty stored name to complete their profile', async () => {
    keycloak.getUserBasicInfo.mockResolvedValue({ id: 'user-1', email: 'user@unesp.br' });
    keycloak.getUserAttributes.mockResolvedValue({ fullName: [''], isOnboarded: ['false'] });
    keycloak.updateUserAttributes.mockResolvedValue(undefined);

    const profile = await service.updateProfile('user-1', {
      fullname: 'User Test',
      phone: '+5514999999999',
      identityDocument: '12345678901',
      isForeigner: false,
    });

    expect(profile.fullname).toBe('User Test');
    expect(profile.isOnboarded).toBe(true);
  });

  it('does not stamp completion when a foreign profile is missing its required passport country', async () => {
    keycloak.getUserBasicInfo.mockResolvedValue({ id: 'user-1', email: 'user@example.test' });
    keycloak.getUserAttributes.mockResolvedValue({});

    await expect(
      service.updateProfile('user-1', {
        fullname: 'User Test',
        phone: '+5514999999999',
        identityDocument: 'P1234567',
        isForeigner: true,
      }),
    ).rejects.toThrow('passportCountry');
    expect(keycloak.updateUserAttributes).not.toHaveBeenCalled();
  });

  it('checks onboarding through the reconciliation operation', async () => {
    keycloak.getUserAttributes.mockResolvedValue({ isOnboarded: ['false'] });
    expect(await service.checkOnboardingStatus('user-1')).toEqual({
      needsOnboarding: true,
      missingFields: ['identity-document', 'phone', 'fullName'],
    });
    expect(keycloak.reconcileUserOnboarding).toHaveBeenCalledWith('user-1');
  });

  it('does not replay onboarding metadata from an OAuth snapshot over a concurrent completion', async () => {
    keycloak.reconcileUserOnboarding
      .mockResolvedValueOnce({ isOnboarded: ['false'], userSchemaVersion: ['0'] })
      .mockResolvedValueOnce({
        isOnboarded: ['true'],
        userSchemaVersion: [String(CURRENT_USER_SCHEMA_VERSION)],
        fullName: ['User Test'],
        phone: ['+5514999999999'],
        'identity-document': ['12345678901'],
        email: ['user@example.test'],
      });
    keycloak.updateUserAttributes.mockResolvedValue(undefined);

    const profile = await service.updateFromKeycloakOAuth({
      sub: 'user-1',
      email: 'user@example.test',
      email_verified: true,
      name: 'User Test',
      preferred_username: 'user',
      given_name: 'User',
      family_name: 'Test',
    });

    expect(keycloak.updateUserAttributes).toHaveBeenCalledWith(
      'user-1',
      {
        displayName: ['User Test'],
        updatedAt: [expect.any(String)],
      },
      { skipValidation: true },
    );
    expect(profile.isOnboarded).toBe(true);
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
