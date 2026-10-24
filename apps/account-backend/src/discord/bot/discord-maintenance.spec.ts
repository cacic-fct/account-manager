import { Job, Queue } from 'bullmq';
import { BackgroundJobData } from '../../background-jobs/background-jobs.queue';
import { DiscordRoleService } from '../services/discord-role.service';
import { DiscordMaintenanceProcessor } from './discord-maintenance.processor';
import { DISCORD_MAINTENANCE_JOBS } from './discord-maintenance.queue';
import { DiscordMaintenanceService } from './discord-maintenance.service';

describe('Discord queued maintenance', () => {
  it('registers stable schedules with a shared concurrency limit', async () => {
    const queue = {
      setGlobalConcurrency: jest.fn().mockResolvedValue(1),
      upsertJobScheduler: jest.fn().mockResolvedValue({}),
    };
    await new DiscordMaintenanceService(queue as unknown as Queue<BackgroundJobData>).onApplicationBootstrap();
    expect(queue.setGlobalConcurrency).toHaveBeenCalledWith(1);
    expect(queue.upsertJobScheduler).toHaveBeenCalledTimes(2);
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      DISCORD_MAINTENANCE_JOBS.SYNC_ROLES,
      expect.objectContaining({ pattern: '* * * * *' }),
      expect.objectContaining({ opts: expect.objectContaining({ attempts: 3 }) as unknown }),
    );
  });

  it('propagates role-sync errors to BullMQ instead of marking the job complete', async () => {
    const roles = { syncAllLinkedMemberRoles: jest.fn().mockRejectedValue(new Error('Discord unavailable')) };
    const processor = new DiscordMaintenanceProcessor(roles as unknown as DiscordRoleService);
    await expect(
      processor.process({ name: DISCORD_MAINTENANCE_JOBS.SYNC_ROLES } as Job<BackgroundJobData>),
    ).rejects.toThrow('Discord unavailable');
    await expect(processor.process({ name: 'unknown' } as Job<BackgroundJobData>)).rejects.toThrow('Unknown');
  });
});
