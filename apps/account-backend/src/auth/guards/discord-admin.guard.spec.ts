import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { AccountPermissionService } from '../services/account-permission.service';
import { DiscordAdminGuard } from './discord-admin.guard';

type AccountPermissionMock = {
  hasDiscordAdminAccess: jest.Mock<
    ReturnType<AccountPermissionService['hasDiscordAdminAccess']>,
    Parameters<AccountPermissionService['hasDiscordAdminAccess']>
  >;
};

const createExecutionContext = (userId: string | null): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        session: userId
          ? {
              user: {
                keycloakId: userId,
              },
            }
          : {},
      }),
    }),
  }) as ExecutionContext;

const createContext = () => {
  const accountPermissionService: AccountPermissionMock = {
    hasDiscordAdminAccess: jest.fn<
      ReturnType<AccountPermissionService['hasDiscordAdminAccess']>,
      Parameters<AccountPermissionService['hasDiscordAdminAccess']>
    >(),
  };
  const guard = new DiscordAdminGuard(accountPermissionService as unknown as AccountPermissionService);

  return {
    accountPermissionService,
    guard,
  };
};

describe('DiscordAdminGuard', () => {
  it('allows users with Discord admin access', async () => {
    const { accountPermissionService, guard } = createContext();
    accountPermissionService.hasDiscordAdminAccess.mockResolvedValue(true);

    await expect(guard.canActivate(createExecutionContext('user-1'))).resolves.toBe(true);

    expect(accountPermissionService.hasDiscordAdminAccess).toHaveBeenCalledWith('user-1');
  });

  it('blocks users without Discord admin access', async () => {
    const { accountPermissionService, guard } = createContext();
    accountPermissionService.hasDiscordAdminAccess.mockResolvedValue(false);

    await expect(guard.canActivate(createExecutionContext('user-1'))).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires an authenticated session', async () => {
    const { accountPermissionService, guard } = createContext();

    await expect(guard.canActivate(createExecutionContext(null))).rejects.toBeInstanceOf(UnauthorizedException);
    expect(accountPermissionService.hasDiscordAdminAccess).not.toHaveBeenCalled();
  });

  it('wraps permission lookup failures as forbidden access', async () => {
    const { accountPermissionService, guard } = createContext();
    accountPermissionService.hasDiscordAdminAccess.mockRejectedValue(new Error('database unavailable'));

    await expect(guard.canActivate(createExecutionContext('user-1'))).rejects.toMatchObject({
      response: {
        message: 'Unable to verify Discord admin permission',
      },
    });
  });
});
