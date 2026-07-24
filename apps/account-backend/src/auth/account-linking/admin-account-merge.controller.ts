import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AccountManagerPermission } from '@cacic/shared-types';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AccountPermissions } from '../guards/auth.decorator';
import { CsrfGuard } from '../csrf/csrf.guard';
import { AccountLinkingService } from './account-linking.service';
import {
  AccountMergeRequestDto,
  AdminCreateAccountMergeDto,
  ConfirmAccountMergeDto,
  ConfirmAccountMergeResponseDto,
} from './dto/account-linking.dto';

const SUPER_ADMIN_PERMISSION = [AccountManagerPermission.SuperAdmin] as const;

@ApiTags('Admin account merges')
@Controller('admin/account-merges')
export class AdminAccountMergeController {
  constructor(private readonly accountLinkingService: AccountLinkingService) {}

  @ApiOperation({ summary: 'Create an account merge request for two existing accounts' })
  @ApiResponse({ status: 201, description: 'Merge request created' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post()
  createMergeRequest(@Body() dto: AdminCreateAccountMergeDto): Promise<AccountMergeRequestDto> {
    return this.accountLinkingService.createAdminMergeRequest(dto.requesterUserId, dto.candidateUserId);
  }

  @ApiOperation({ summary: 'Get an account merge request created by an administrator' })
  @ApiResponse({ status: 200, description: 'Merge request returned' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @Get(':id')
  getMergeRequest(@Param('id') id: string): Promise<AccountMergeRequestDto> {
    return this.accountLinkingService.getAdminRequest(id);
  }

  @ApiOperation({ summary: 'Confirm an administrator-created account merge request' })
  @ApiResponse({ status: 200, description: 'Merge processing started' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post(':id/confirm')
  confirmMerge(
    @Param('id') id: string,
    @Body() dto: ConfirmAccountMergeDto,
  ): Promise<ConfirmAccountMergeResponseDto> {
    return this.accountLinkingService.confirmAdminMerge(id, dto.primaryEmail);
  }

  @ApiOperation({ summary: 'Cancel an administrator-created account merge request' })
  @ApiResponse({ status: 200, description: 'Merge request cancelled' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post(':id/cancel')
  async cancelMerge(@Param('id') id: string): Promise<{ success: true }> {
    await this.accountLinkingService.cancelAdminRequest(id);
    return { success: true };
  }
}
