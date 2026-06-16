import { Controller, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Admin } from '../../auth/guards/auth.decorator';
import { CsrfGuard } from '../../auth/csrf/csrf.guard';
import { LgpdService } from '../../lgpd/lgpd.service';

@ApiTags('Admin Cleanup')
@Controller('admin/cleanup')
export class AdminCleanupController {
  constructor(private readonly lgpdService: LgpdService) {}

  @ApiOperation({ summary: 'Clean up expired LGPD export files' })
  @ApiResponse({
    status: 200,
    description: 'Expired LGPD export cleanup completed',
    schema: {
      type: 'object',
      properties: {
        success: { type: 'boolean' },
        cleanedFiles: { type: 'number' },
      },
    },
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Post('lgpd-expired-files')
  async cleanupExpiredLgpdFiles(): Promise<{
    success: true;
    cleanedFiles: number;
  }> {
    const cleanedFiles = await this.lgpdService.cleanupExpiredFiles();
    return { success: true, cleanedFiles };
  }
}
