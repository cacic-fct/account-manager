import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountManagerPermission } from '@cacic/shared-types';
import { AccountPermissions } from '../../auth/guards/auth.decorator';
import { SkipCsrf } from '../../auth/csrf/csrf.guard';
import { OperationalMetricsService, type OperationalMetricsSnapshot } from '../services/operational-metrics.service';

@ApiTags('Operational status')
@Controller('admin/operations')
export class OperationalMetricsController {
  constructor(private readonly metricsService: OperationalMetricsService) {}

  @ApiOperation({
    summary: 'Read persisted operational metrics',
    description: 'Returns aggregate workflow counts and oldest ages without user identifiers or raw dependency errors.',
  })
  @ApiResponse({ status: 200, description: 'Operational metrics snapshot' })
  @ApiResponse({ status: 403, description: 'Super-admin permission required' })
  @AccountPermissions([AccountManagerPermission.SuperAdmin])
  @SkipCsrf()
  @Get('metrics')
  getMetrics(): Promise<OperationalMetricsSnapshot> {
    return this.metricsService.getSnapshot();
  }
}
