import {
  Controller,
  Post,
  Get,
  Param,
  ParseUUIDPipe,
  Session,
  Res,
  Body,
  HttpException,
  HttpStatus,
  BadRequestException,
  UseGuards,
  Logger,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { Response } from 'express';
import { pipeline } from 'stream/promises';
import { LgpdService } from './lgpd.service';
import { LgpdRequestDto, LgpdRequestListDto } from './dto/lgpd-request.dto';
import {
  DeleteAccountRequestDto,
  AdminDeleteAccountRequestDto,
  DeleteAccountResponseDto,
} from './dto/delete-account.dto';
import { SessionUser } from '../auth/interfaces/auth.interface';
import { AccountPermissions, Auth } from '../auth/guards/auth.decorator';
import { AccountManagerPermission } from '@cacic/shared-types';
import { CsrfGuard, SkipCsrf } from '../auth/csrf/csrf.guard';
import { CurrentUserGuard } from '../auth/guards/current-user.guard';

interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

@ApiTags('LGPD (Data Protection)')
@Controller('lgpd')
export class LgpdController {
  private readonly logger = new Logger(LgpdController.name);

  constructor(private readonly lgpdService: LgpdService) {}

  private getSessionUser(session: AuthSession): SessionUser {
    return session.user!;
  }

  private getContentDisposition(fileName: string): string {
    const sanitizedFileName = Array.from(fileName)
      .filter((character) => {
        const charCode = character.charCodeAt(0);
        return charCode > 31 && charCode !== 127;
      })
      .join('')
      .replace(/"/g, '')
      .trim();
    const safeFileName = sanitizedFileName || 'dados-lgpd.zip';

    return `attachment; filename="${safeFileName}"; filename*=UTF-8''${encodeURIComponent(safeFileName)}`;
  }

  @ApiOperation({
    summary: 'Create LGPD data request',
    description:
      'Creates a new LGPD data request for the authenticated user. This will generate a ZIP file containing all user data.',
  })
  @ApiResponse({
    status: 201,
    description: 'LGPD data request created successfully',
    type: LgpdRequestDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - User already has pending request or other validation error',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 500,
    description: 'Internal Server Error',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('request')
  async createDataRequest(@Session() session: AuthSession): Promise<LgpdRequestDto> {
    const user = this.getSessionUser(session);

    try {
      return await this.lgpdService.createRequest(user.keycloakId, user.email);
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException('Erro interno do servidor', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @ApiOperation({
    summary: 'Get user LGPD requests',
    description: 'Returns a list of all LGPD data requests for the authenticated user.',
  })
  @ApiResponse({
    status: 200,
    description: 'List of user LGPD requests',
    type: [LgpdRequestListDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @UseGuards(CurrentUserGuard)
  @SkipCsrf()
  @Get('requests')
  async getUserRequests(@Session() session: AuthSession): Promise<LgpdRequestListDto[]> {
    const user = this.getSessionUser(session);

    return await this.lgpdService.getUserRequests(user.keycloakId);
  }

  @ApiOperation({
    summary: 'Get specific LGPD request',
    description: 'Returns detailed information about a specific LGPD data request.',
  })
  @ApiParam({
    name: 'id',
    description: 'LGPD request ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'LGPD request details',
    type: LgpdRequestDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Request not found or does not belong to user',
  })
  @Auth()
  @UseGuards(CurrentUserGuard)
  @Get('request/:id')
  async getRequest(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Session() session: AuthSession,
  ): Promise<LgpdRequestDto> {
    const user = this.getSessionUser(session);

    return await this.lgpdService.getRequestById(id, user.keycloakId);
  }

  @ApiOperation({
    summary: 'Download LGPD data file',
    description: 'Downloads the generated ZIP file containing user data for a completed LGPD request.',
  })
  @ApiParam({
    name: 'id',
    description: 'LGPD request ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'ZIP file containing user data',
    headers: {
      'Content-Type': {
        description: 'MIME type of the file',
        schema: { type: 'string', example: 'application/zip' },
      },
      'Content-Disposition': {
        description: 'File download disposition',
        schema: {
          type: 'string',
          example: 'attachment; filename="dados-lgpd-123.zip"',
        },
      },
    },
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - File not ready or expired',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 404,
    description: 'Not Found - Request or file not found',
  })
  @Auth()
  @UseGuards(CurrentUserGuard)
  @Get('download/:id')
  async downloadFile(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
    @Session() session: AuthSession,
    @Res() res: Response,
  ): Promise<void> {
    const user = this.getSessionUser(session);

    try {
      const { stream, fileName } = await this.lgpdService.downloadFile(id, user.keycloakId);

      // Set appropriate headers for file download
      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Disposition', this.getContentDisposition(fileName));

      // pipeline closes the source on response aborts and propagates both source and destination
      // errors. downloadedAt is written only after the response has fully flushed.
      await pipeline(stream, res);
      await this.lgpdService.markDownloadDelivered(id, user.keycloakId);
    } catch (error) {
      this.logger.error('Error streaming LGPD file', error);
      if (error instanceof HttpException) {
        throw error;
      }
      if (!res.headersSent) {
        throw new HttpException('Erro interno do servidor', HttpStatus.INTERNAL_SERVER_ERROR);
      }
    }
  }

  @ApiOperation({
    summary: 'Request account deletion',
    description:
      'Initiates the account deletion process for the authenticated user. This will permanently delete all user data across all services.',
  })
  @ApiResponse({
    status: 201,
    description: 'Account deletion request initiated successfully',
    type: DeleteAccountResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Bad Request - Invalid confirmation or user already has pending deletion request',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Post('delete-account')
  async requestAccountDeletion(
    @Body() dto: DeleteAccountRequestDto,
    @Session() session: AuthSession,
  ): Promise<DeleteAccountResponseDto> {
    const user = this.getSessionUser(session);

    return await this.lgpdService.requestAccountDeletion(user.keycloakId, user.email, dto);
  }

  @ApiOperation({
    summary: 'List pending account deletion requests',
  })
  @AccountPermissions([AccountManagerPermission.AccountDeletionRead])
  @SkipCsrf()
  @Get('admin/delete-account-requests')
  async getPendingAccountDeletionRequests(): Promise<AdminDeleteAccountRequestDto[]> {
    return await this.lgpdService.getPendingAccountDeletionRequests();
  }

  @ApiOperation({
    summary: 'Undo account deletion request',
  })
  @AccountPermissions([AccountManagerPermission.AccountDeletionUpdate])
  @UseGuards(CsrfGuard)
  @Post('admin/delete-account-requests/:id/undo')
  async undoAccountDeletionRequest(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AdminDeleteAccountRequestDto> {
    return await this.lgpdService.undoAccountDeletionRequest(id);
  }

  @ApiOperation({
    summary: 'Schedule account deletion immediately',
  })
  @AccountPermissions([AccountManagerPermission.AccountDeletionUpdate])
  @UseGuards(CsrfGuard)
  @Post('admin/delete-account-requests/:id/delete-now')
  async deleteAccountNow(
    @Param('id', new ParseUUIDPipe({ version: '7' })) id: string,
  ): Promise<AdminDeleteAccountRequestDto> {
    return await this.lgpdService.deleteAccountNow(id);
  }
}
