import { BadRequestException } from '@nestjs/common';
import { DiscordSettingsService } from './discord-settings.service';

describe(DiscordSettingsService.name, () => {
  const prisma = {
    discordServerSettings: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
  };
  const service = new DiscordSettingsService(prisma as never);

  beforeEach(() => jest.clearAllMocks());

  it('rejects unknown setting keys before persistence', async () => {
    await expect(
      service.updateServerSetting('arbitrary_redirect', { value: 'https://discord.gg/example' }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(prisma.discordServerSettings.upsert).not.toHaveBeenCalled();
  });

  it.each([
    'javascript:alert(1)',
    'http://discord.gg/example',
    'https://discord.gg.example.test/invite',
    'https://discord.com/channels/example',
    'https://user:password@discord.gg/example',
  ])('rejects an unsafe Discord invite link: %s', async (value) => {
    await expect(service.updateServerSetting('student_invite_link', { value })).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(prisma.discordServerSettings.upsert).not.toHaveBeenCalled();
  });

  it('normalizes and stores an official HTTPS Discord invite link', async () => {
    prisma.discordServerSettings.upsert.mockResolvedValue({
      id: 'setting-id',
      settingKey: 'student_invite_link',
      settingValue: 'https://discord.gg/example',
      description: 'Convite para estudantes',
      updatedAt: new Date('2026-09-08T00:00:00.000Z'),
    });

    await service.updateServerSetting('student_invite_link', { value: ' https://discord.gg/example ' });

    expect(prisma.discordServerSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        update: { settingValue: 'https://discord.gg/example' },
      }),
    );
  });

  it('suppresses an unsafe legacy invite link when it is read', async () => {
    prisma.discordServerSettings.findUnique.mockResolvedValue({
      settingKey: 'student_invite_link',
      settingValue: 'javascript:alert(1)',
    });

    await expect(service.getServerSetting('student_invite_link')).resolves.toBeNull();
  });
});
