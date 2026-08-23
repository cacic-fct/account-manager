import { PrivacyService } from './privacy.service';
import { createDefaultPrivacySettings, PRIVACY_SETTING_TYPES } from './constants/privacy-setting.constants';

describe(PrivacyService.name, () => {
  it('preserves independent concurrent privacy changes through optimistic retries', async () => {
    let revision = 0;
    let record = {
      id: '00000000-0000-7000-8000-000000000001',
      userId: 'user-1',
      settings: createDefaultPrivacySettings(),
      metadata: {},
      createdAt: new Date('2026-08-23T12:00:00.000Z'),
      updatedAt: new Date('2026-08-23T12:00:00.000Z'),
    };
    const clone = () => structuredClone(record);
    const prisma = {
      privacySetting: {
        upsert: jest.fn(() => Promise.resolve(clone())),
        findUnique: jest.fn(() => Promise.resolve(clone())),
        updateMany: jest.fn(({ where, data }: { where: { updatedAt: Date }; data: typeof record }) => {
          if (where.updatedAt.getTime() !== record.updatedAt.getTime()) {
            return Promise.resolve({ count: 0 });
          }
          revision += 1;
          record = {
            ...record,
            ...data,
            updatedAt: new Date(record.updatedAt.getTime() + revision),
          };
          return Promise.resolve({ count: 1 });
        }),
      },
    };
    const service = new PrivacyService(prisma as never);

    await Promise.all([
      service.updatePrivacySetting('user-1', PRIVACY_SETTING_TYPES.ANALYTICS_TRACKING, { enabled: false }),
      service.updatePrivacySetting('user-1', PRIVACY_SETTING_TYPES.ERROR_DEBUGGING, { enabled: true }),
    ]);

    expect(record.settings).toMatchObject({
      analytics_tracking: false,
      error_debugging: true,
    });
    expect(prisma.privacySetting.updateMany).toHaveBeenCalledTimes(3);
  });
});
