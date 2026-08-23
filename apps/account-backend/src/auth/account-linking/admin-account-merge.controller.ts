import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  ParseUUIDPipe,
  Post,
  Session,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccountManagerPermission } from '@cacic/shared-types';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Observable } from 'rxjs';
import { AuthSession } from '../auth.controller';
import { AccountPermissions } from '../guards/auth.decorator';
import { CsrfGuard } from '../csrf/csrf.guard';
import { AccountLinkingService } from './account-linking.service';
import {
  AccountMergeRequestDto,
  AdminCreateAccountMergeDto,
  ConfirmAccountMergeDto,
  ConfirmAccountMergeResponseDto,
} from './dto/account-linking.dto';
import { createMergeRequestStream } from './merge-request-stream.util';

const SUPER_ADMIN_PERMISSION = [AccountManagerPermission.SuperAdmin] as const;

@ApiTags('Admin account merges')
@Controller('admin/account-merges')
export class AdminAccountMergeController {
  constructor(private readonly accountLinkingService: AccountLinkingService) {}

  @ApiOperation({
    summary: 'Create an account merge request for two existing accounts',
    description:
      'Creates a short-lived merge request for two existing Keycloak accounts. The authenticated super administrator is recorded in the audit log.',
  })
  @ApiResponse({
    status: 201,
    description: 'Merge request created',
    example: {
      id: '1d4e4762-42f9-4d79-a9e4-3949bb799d68',
      status: 'pending',
      requesterUserId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
      candidateUserId: 'ee2f238b-afc1-4012-ae23-6f9b604a119e',
    },
  })
  @ApiResponse({ status: 404, description: 'One or both requested accounts do not exist' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post()
  createMergeRequest(
    @Body() dto: AdminCreateAccountMergeDto,
    @Session() session: AuthSession,
  ): Promise<AccountMergeRequestDto> {
    return this.accountLinkingService.createAdminMergeRequest(
      dto.requesterUserId,
      dto.candidateUserId,
      this.getSessionUserId(session),
    );
  }

  @ApiOperation({
    summary: 'Get an account merge request created by an administrator',
    description:
      'Returns the selected accounts, current processing status, score breakdown, and external notification progress.',
  })
  @ApiParam({ name: 'id', description: 'Account merge request id', example: '1d4e4762-42f9-4d79-a9e4-3949bb799d68' })
  @ApiResponse({
    status: 200,
    description: 'Merge request returned',
    example: { id: '1d4e4762-42f9-4d79-a9e4-3949bb799d68', status: 'pending_score' },
  })
  @ApiResponse({ status: 404, description: 'Merge request does not exist' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @Get(':id')
  getMergeRequest(@Param('id', new ParseUUIDPipe({ version: '7' })) id: string): Promise<AccountMergeRequestDto> {
    return this.accountLinkingService.getAdminRequest(id);
  }

  @ApiOperation({
    summary: 'Stream administrator account merge status updates',
    description: 'Sends a complete initial request followed by SSE deltas until the request is terminal.',
  })
  @ApiParam({ name: 'id', description: 'Account merge request id', example: '1d4e4762-42f9-4d79-a9e4-3949bb799d68' })
  @ApiResponse({
    status: 200,
    description:
      'SSE events containing a full AccountMergeRequest snapshot first, then AccountMergeRequestDelta updates.',
    type: Object,
    example: { id: '1d4e4762-42f9-4d79-a9e4-3949bb799d68', status: 'pending_merge' },
  })
  @ApiResponse({ status: 404, description: 'Merge request does not exist' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @Sse(':id/events')
  async streamMergeRequest(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<Observable<MessageEvent>> {
    const initialRequest = await this.accountLinkingService.getAdminRequest(id);
    return createMergeRequestStream(
      initialRequest,
      () => this.accountLinkingService.openMergeRequestWatch(id),
      () => this.accountLinkingService.getAdminRequest(id),
    );
  }

  @ApiOperation({
    summary: 'Confirm an administrator-created account merge request',
    description:
      'Validates the selected primary email, marks the request for processing, and queues the account merge. The authenticated super administrator is recorded in the audit log.',
  })
  @ApiParam({ name: 'id', description: 'Account merge request id', example: '1d4e4762-42f9-4d79-a9e4-3949bb799d68' })
  @ApiResponse({
    status: 200,
    description: 'Merge processing started',
    example: { primaryUserId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987', primaryEmail: 'user@unesp.br' },
  })
  @ApiResponse({ status: 400, description: 'Merge request is expired or has already been processed' })
  @ApiResponse({ status: 404, description: 'Merge request does not exist' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post(':id/confirm')
  confirmMerge(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Body() dto: ConfirmAccountMergeDto,
    @Session() session: AuthSession,
  ): Promise<ConfirmAccountMergeResponseDto> {
    return this.accountLinkingService.confirmAdminMerge(id, dto.primaryEmail, this.getSessionUserId(session));
  }

  @ApiOperation({
    summary: 'Cancel an administrator-created account merge request',
    description:
      'Cancels a request that has not completed. The authenticated super administrator is recorded in the audit log before cancellation.',
  })
  @ApiParam({ name: 'id', description: 'Account merge request id', example: '1d4e4762-42f9-4d79-a9e4-3949bb799d68' })
  @ApiResponse({ status: 200, description: 'Merge request cancelled', example: { success: true } })
  @ApiResponse({ status: 404, description: 'Merge request does not exist' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post(':id/cancel')
  async cancelMerge(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Session() session: AuthSession,
  ): Promise<{ success: true }> {
    await this.accountLinkingService.cancelAdminRequest(id, this.getSessionUserId(session));
    return { success: true };
  }

  @ApiOperation({
    summary: 'Retry a terminally failed external merge notification',
    description: 'Reopens one failed downstream notification and schedules one bounded manual retry sequence.',
  })
  @ApiParam({ name: 'id', description: 'Account merge request id' })
  @ApiParam({ name: 'notificationId', description: 'External notification id' })
  @ApiResponse({ status: 200, description: 'Notification retry scheduled' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @UseGuards(CsrfGuard)
  @Post(':id/notifications/:notificationId/retry')
  async retryNotification(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Param('notificationId', new ParseUUIDPipe({ version: '7' })) notificationId: string,
  ): Promise<{ success: true }> {
    await this.accountLinkingService.retryExternalNotification(id, notificationId);
    return { success: true };
  }

  private getSessionUserId(session: AuthSession): string {
    const keycloakId = session.user?.keycloakId;
    if (!keycloakId) {
      throw new UnauthorizedException();
    }

    return keycloakId;
  }
}
