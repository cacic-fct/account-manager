import type { DiscordLink } from '@prisma/client';
import { DiscordAccountAlreadyLinkedException, DiscordLinkService } from './discord-link.service';

const createLink = (): DiscordLink => ({
  id: 'link-1',
  userId: 'user-1',
  discordId: 'discord-1',
  discordUsername: 'student',
  discordGlobalName: 'Student',
  discordAvatarHash: null,
  isVerified: true,
  assignedRole: 'student',
  serverInviteUsed: null,
  deleted: false,
  deletedAt: null,
  createdAt: new Date('2026-10-23T12:00:00Z'),
  updatedAt: new Date('2026-10-23T12:00:00Z'),
});

const createContext = () => {
  const link = createLink();
  const prisma = {
    discordLink: {
      findMany: jest.fn().mockImplementation(() => Promise.resolve([{ ...link }])),
      findFirst: jest.fn().mockResolvedValue(link),
      update: jest.fn().mockResolvedValue(link),
    },
  };
  const roles = {
    syncUserDiscordRoles: jest.fn().mockImplementation(() => {
      link.assignedRole = 'unesp';
      return Promise.resolve();
    }),
    checkRoleEligibility: jest.fn().mockResolvedValue('unesp'),
    assignUserRole: jest.fn().mockResolvedValue({ eligibleRole: 'unesp' }),
  };
  const settings = { getServerSetting: jest.fn().mockResolvedValue('https://discord.gg/example') };
  const oauth = {
    exchangeCodeForToken: jest.fn().mockResolvedValue({ access_token: 'token' }),
    getDiscordUserInfo: jest.fn().mockResolvedValue({ id: link.discordId }),
  };
  const service = new DiscordLinkService(prisma as never, oauth as never, roles as never, settings as never);
  return { link, prisma, roles, settings, service };
};

describe('DiscordLinkService synchronized responses', () => {
  it('reconciles before loading links and removes student invite access after verification is reset', async () => {
    const { roles, settings, service } = createContext();

    await expect(service.getDiscordLinkStatus('user-1')).resolves.toMatchObject({
      eligibleForRole: 'unesp',
      discordLinks: [{ assignedRole: 'unesp' }],
      inviteLink: undefined,
    });
    expect(roles.syncUserDiscordRoles).toHaveBeenCalledWith('user-1', 'discord-status-refresh');
    expect(settings.getServerSetting).not.toHaveBeenCalled();
  });

  it('keeps student invite access for a student exception or a disabled verification requirement', async () => {
    const { link, roles, service } = createContext();
    roles.syncUserDiscordRoles.mockImplementation(() => {
      link.assignedRole = 'student';
      return Promise.resolve();
    });
    roles.checkRoleEligibility.mockResolvedValue('student');

    await expect(service.getDiscordLinkStatus('user-1')).resolves.toMatchObject({
      eligibleForRole: 'student',
      discordLinks: [{ assignedRole: 'student' }],
      inviteLink: 'https://discord.gg/example',
    });
  });

  it('returns the reconciled category after linking an existing account', async () => {
    const { service } = createContext();

    await expect(service.linkDiscordAccount('user-1', { code: 'code', state: 'state' })).resolves.toMatchObject({
      assignedRole: 'unesp',
    });
  });

  it('preserves the linked-account redirect signal without revealing who owns the account', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValueOnce({ ...createLink(), userId: 'another-user' });

    const error = await service
      .linkDiscordAccount('user-1', { code: 'code', state: 'state' })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DiscordAccountAlreadyLinkedException);
    if (error instanceof DiscordAccountAlreadyLinkedException) {
      expect(error.getStatus()).toBe(400);
      expect(error.message).toBe(
        'Esta conta do Discord não pode ser vinculada. Use outra conta ou fale com o suporte.',
      );
    }
  });

  it('returns the reconciled category after restoring a link', async () => {
    const { prisma, service } = createContext();
    prisma.discordLink.findFirst.mockResolvedValueOnce(createLink()).mockResolvedValueOnce(null);

    await expect(service.restoreDiscordLink('link-1')).resolves.toMatchObject({ assignedRole: 'unesp' });
  });
});
