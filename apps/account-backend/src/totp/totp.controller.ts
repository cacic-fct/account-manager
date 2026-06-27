import {
  Controller,
  Delete,
  Get,
  Post,
  Session,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthSession } from '../auth/auth.controller';
import { Auth } from '../auth/guards/auth.decorator';
import { CurrentUserGuard } from '../auth/guards/current-user.guard';
import { CsrfGuard, SkipCsrf } from '../auth/csrf/csrf.guard';
import { TotpService } from './totp.service';
import { TotpSeedDto, TotpStatusDto } from './dto/totp.dto';

@ApiTags('TOTP')
@ApiBearerAuth()
@Controller('totp')
export class TotpController {
  constructor(private readonly totpService: TotpService) {}

  @Get('status')
  @Auth()
  @SkipCsrf()
  @ApiOperation({
    summary: 'Get current user TOTP status',
    description:
      'Returns whether the authenticated user has an offline TOTP seed configured without exposing the seed.',
  })
  @ApiResponse({
    status: 200,
    description: 'TOTP status for the authenticated user.',
    type: TotpStatusDto,
  })
  getStatus(@Session() session: AuthSession): Promise<TotpStatusDto> {
    return this.totpService.getStatus(session.user!.keycloakId);
  }

  @Post('seed')
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Get or create current user TOTP seed',
    description:
      'Returns the Base32 seed used by the authenticated user to generate six digit offline TOTP codes. Clients must clear this seed when the session expires or the user logs out.',
  })
  @ApiResponse({
    status: 200,
    description: 'Current user TOTP seed.',
    type: TotpSeedDto,
  })
  getOrCreateSeed(@Session() session: AuthSession): Promise<TotpSeedDto> {
    return this.totpService.getOrCreateSeed({
      keycloakId: session.user!.keycloakId,
      primaryEmail: session.user!.email,
    });
  }

  @Post('seed/rotate')
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Rotate current user TOTP seed',
    description:
      'Replaces the current offline TOTP seed. Previously cached seeds stop producing valid codes immediately.',
  })
  @ApiResponse({
    status: 200,
    description: 'Rotated current user TOTP seed.',
    type: TotpSeedDto,
  })
  rotateSeed(@Session() session: AuthSession): Promise<TotpSeedDto> {
    return this.totpService.rotateSeed({
      keycloakId: session.user!.keycloakId,
      primaryEmail: session.user!.email,
    });
  }

  @Delete('seed')
  @Auth()
  @UseGuards(CurrentUserGuard, CsrfGuard)
  @ApiOperation({
    summary: 'Disable current user TOTP seed',
    description:
      'Clears the current offline TOTP seed. M2M validation for this email will fail until a new seed is created.',
  })
  @ApiResponse({
    status: 200,
    description: 'Updated TOTP status for the authenticated user.',
    type: TotpStatusDto,
  })
  disableSeed(@Session() session: AuthSession): Promise<TotpStatusDto> {
    return this.totpService.disableSeed(session.user!.keycloakId);
  }
}
