import {
  AccountManagerKeycloakRole,
  AssignableKeycloakPermission,
} from '@cacic/shared-types';
import { PrismaService } from '../../prisma/prisma.service';
import { AccountPermissionService } from './account-permission.service';

type PrismaMock = {
  keycloakPermissionGrant: {
    findFirst: jest.Mock<Promise<{ id: string } | null>, [unknown]>;
  };
};

type PermissionGrantFindFirstArgs = {
  where: {
    userId: string;
    deletedAt: null;
    permission: {
      in: string[];
    };
  };
};

const getMockArg = <T>(
  mock: { mock: { calls: [unknown][] } },
  callIndex = 0,
): T => {
  const call = mock.mock.calls[callIndex];
  if (!call) {
    throw new Error(`Expected mock call ${callIndex} to exist.`);
  }

  return call[0] as T;
};

const createContext = () => {
  const prisma: PrismaMock = {
    keycloakPermissionGrant: {
      findFirst: jest.fn<Promise<{ id: string } | null>, [unknown]>(),
    },
  };
  const service = new AccountPermissionService(
    prisma as unknown as PrismaService,
  );

  return {
    prisma,
    service,
  };
};

describe('AccountPermissionService', () => {
  it('checks active grants with the requested permission set', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
    });

    await expect(
      service.hasAnyActivePermission('user-1', [
        AssignableKeycloakPermission.AccountManagerAccess,
      ]),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionGrantFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.userId).toBe('user-1');
    expect(findFirstArgs.where.deletedAt).toBeNull();
    expect(findFirstArgs.where.permission.in).toEqual([
      AssignableKeycloakPermission.AccountManagerAccess,
    ]);
  });

  it('treats Account Manager super-admin as Discord admin access', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue(null);

    await expect(service.hasDiscordAdminAccess('user-1')).resolves.toBe(false);

    const findFirstArgs = getMockArg<PermissionGrantFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.permission.in).toEqual([
      AccountManagerKeycloakRole.SuperAdmin,
    ]);
  });

  it('does not query the database for an empty permission set', async () => {
    const { prisma, service } = createContext();

    await expect(service.hasAnyActivePermission('user-1', [])).resolves.toBe(
      false,
    );

    expect(prisma.keycloakPermissionGrant.findFirst).not.toHaveBeenCalled();
  });

  it('checks the Account Manager super-admin grant wrapper', async () => {
    const { prisma, service } = createContext();
    prisma.keycloakPermissionGrant.findFirst.mockResolvedValue({
      id: 'grant-1',
    });

    await expect(
      service.hasAccountManagerSuperAdminGrant('user-1'),
    ).resolves.toBe(true);

    const findFirstArgs = getMockArg<PermissionGrantFindFirstArgs>(
      prisma.keycloakPermissionGrant.findFirst,
    );
    expect(findFirstArgs.where.permission.in).toEqual([
      AccountManagerKeycloakRole.SuperAdmin,
    ]);
  });
});
