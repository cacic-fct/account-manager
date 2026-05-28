import {
  Controller,
  Get,
  Delete,
  Param,
  Session,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiResponse } from '@nestjs/swagger';
import { DiscordLinkService } from '../services/discord-link.service';
import { Auth } from '../../auth/guards/auth.decorator';
import { CurrentUserGuard } from '../../auth/guards/current-user.guard';
import { CsrfGuard } from '../../auth/csrf/csrf.guard';
import {
  DiscordLinkStatusDto,
  UnlinkDiscordResponseDto,
} from '../dto/discord-link.dto';

interface AuthSession {
  user?: SessionUser;
  accessToken?: string;
  refreshToken?: string;
  destroy: (callback: (err?: Error) => void) => void;
}

interface SessionUser {
  keycloakId: string;
  email: string;
  fullname: string;
  displayName: string;
}

@ApiTags('Discord Links')
@Controller('discord/links')
export class DiscordLinksController {
  constructor(private readonly discordLinkService: DiscordLinkService) {}

  @ApiOperation({
    summary: 'Get Discord link status',
    description:
      'Get the Discord link status for the authenticated user, including invite links for eligible users',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord link status returned successfully',
    type: DiscordLinkStatusDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('status')
  async getDiscordLinkStatus(
    @Session() session: AuthSession,
  ): Promise<DiscordLinkStatusDto> {
    return await this.discordLinkService.getDiscordLinkStatus(
      session.user!.keycloakId, // Safe to use ! because Auth guard ensures user exists
    );
  }

  @ApiOperation({
    summary: 'Unlink Discord account',
    description: 'Unlink a specific Discord account from the user profile',
  })
  @ApiParam({
    name: 'linkId',
    description: 'Discord link ID to unlink',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord account unlinked successfully',
    type: UnlinkDiscordResponseDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 404,
    description: 'No Discord link found for this user',
  })
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @Delete(':linkId')
  async unlinkDiscord(
    @Param('linkId') linkId: string,
    @Session() session: AuthSession,
  ): Promise<UnlinkDiscordResponseDto> {
    await this.discordLinkService.unlinkDiscordAccount(
      session.user!.keycloakId, // Safe to use ! because Auth guard ensures user exists
      linkId,
    );
    return { message: 'Conta do Discord desvinculada com sucesso' };
  }
}
