import 'reflect-metadata';
import { AccountManagerPermission } from '@cacic/shared-types';
import { ACCOUNT_PERMISSIONS_KEY } from '../../auth/guards/account-permission.guard';
import { OperationalMetricsController } from './operational-metrics.controller';

describe(OperationalMetricsController.name, () => {
  it('requires the existing super-admin read boundary and delegates the snapshot', async () => {
    const snapshot = { generatedAt: '2026-08-23T15:00:00.000Z', domains: {} };
    const metricsService = { getSnapshot: jest.fn().mockResolvedValue(snapshot) };
    const controller = new OperationalMetricsController(metricsService as never);

    await expect(controller.getMetrics()).resolves.toBe(snapshot);
    expect(metricsService.getSnapshot).toHaveBeenCalledTimes(1);
    const handler = getControllerHandler('getMetrics');
    expect(Reflect.getMetadata(ACCOUNT_PERMISSIONS_KEY, handler)).toEqual({
      permissions: [AccountManagerPermission.SuperAdmin],
      mode: 'any',
    });
  });

  function getControllerHandler(method: string): object {
    return Object.getOwnPropertyDescriptor(OperationalMetricsController.prototype, method)?.value as object;
  }
});
