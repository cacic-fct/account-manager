import {
  Body,
  Controller,
  Get,
  MessageEvent,
  Param,
  Post,
  Session,
  Sse,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AccountManagerPermission, AccountMergeRequest, AccountMergeRequestDelta } from '@cacic/shared-types';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { concat, concatMap, from, map, Observable, of, scan } from 'rxjs';
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
  getMergeRequest(@Param('id') id: string): Promise<AccountMergeRequestDto> {
    return this.accountLinkingService.getAdminRequest(id);
  }

  @ApiOperation({ summary: 'Stream administrator account merge status updates' })
  @AccountPermissions(SUPER_ADMIN_PERMISSION)
  @Sse(':id/events')
  async streamMergeRequest(@Param('id') id: string): Promise<Observable<MessageEvent>> {
    const initialRequest = await this.accountLinkingService.getAdminRequest(id);

    return concat(
      of(initialRequest),
      this.accountLinkingService
        .watchMergeRequest(id)
        .pipe(concatMap(() => from(this.accountLinkingService.getAdminRequest(id)))),
    ).pipe(
      scan((state, request) => ({ previous: request, delta: toMergeRequestDelta(state.previous, request) }), {
        previous: null as AccountMergeRequest | null,
        delta: null as AccountMergeRequestDelta | null,
      }),
      map(({ delta }) => ({ data: delta! })),
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
    @Param('id') id: string,
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
  async cancelMerge(@Param('id') id: string, @Session() session: AuthSession): Promise<{ success: true }> {
    await this.accountLinkingService.cancelAdminRequest(id, this.getSessionUserId(session));
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

function toMergeRequestDelta(
  previous: AccountMergeRequest | null,
  current: AccountMergeRequest,
): AccountMergeRequestDelta {
  if (!previous) {
    return current;
  }

  const delta: AccountMergeRequestDelta = { id: current.id };
  for (const key of Object.keys(current) as Array<keyof AccountMergeRequest>) {
    if (key !== 'id' && JSON.stringify(previous[key]) !== JSON.stringify(current[key])) {
      Object.assign(delta, { [key]: current[key] });
    }
  }

  return delta;
}
