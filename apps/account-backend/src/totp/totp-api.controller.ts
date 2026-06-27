import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { M2M_TOTP_ROLES } from '@cacic/m2m-contracts';
import { M2MGuard, M2MProtected, RequireRoles } from '../auth/jwt/m2m.guard';
import { TotpService } from './totp.service';
import {
  M2MTotpValidateDto,
  M2MTotpValidateResponseDto,
  TotpSeedDto,
} from './dto/totp.dto';

@ApiTags('External API - TOTP')
@Controller('v1/totp')
@UseGuards(M2MGuard)
@M2MProtected()
@ApiBearerAuth()
export class TotpApiController {
  constructor(private readonly totpService: TotpService) {}

  @Post('validate')
  @RequireRoles(M2M_TOTP_ROLES.VALIDATE)
  @ApiOperation({
    summary: 'Validate offline TOTP credentials',
    description:
      'Validates a primary email and six digit TOTP using a 30 second step and ±1 step window per RFC 6238. Requires M2M authentication with the totp:validate role.',
  })
  @ApiBody({
    type: M2MTotpValidateDto,
    description: 'Offline credential submitted by another CACiC app.',
  })
  @ApiResponse({
    status: 200,
    description:
      'Validation result. Failed validations do not disclose user existence.',
    type: M2MTotpValidateResponseDto,
  })
  validate(
    @Body() body: M2MTotpValidateDto,
  ): Promise<M2MTotpValidateResponseDto> {
    return this.totpService.validateCode(body.primaryEmail, body.code);
  }

  @Get('user/:userId/seed')
  @RequireRoles(M2M_TOTP_ROLES.RELAY)
  @ApiOperation({
    summary: 'Relay a user TOTP seed to a trusted offline-capable CACiC app',
    description:
      'Returns or creates the user TOTP seed for trusted app-side offline storage. The receiving app must clear this seed when its authenticated session expires or the user logs out. Requires M2M authentication with the totp:relay role.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak subject for the user.',
    example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
  })
  @ApiResponse({
    status: 200,
    description: 'TOTP seed payload for the requested user.',
    type: TotpSeedDto,
  })
  relaySeed(@Param('userId') userId: string): Promise<TotpSeedDto> {
    return this.totpService.relaySeed(userId);
  }

  @Post('user/:userId/seed')
  @RequireRoles(M2M_TOTP_ROLES.RELAY)
  @ApiOperation({
    summary: 'Ensure and relay a user TOTP seed to a trusted CACiC app',
    description:
      'Creates the lean Account Manager user projection and default TOTP seed when needed, then returns the seed to the trusted offline-capable app. Requires M2M authentication with the totp:relay role.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak subject for the user.',
    example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
  })
  @ApiResponse({
    status: 200,
    description: 'TOTP seed payload for the requested user.',
    type: TotpSeedDto,
  })
  ensureSeed(@Param('userId') userId: string): Promise<TotpSeedDto> {
    return this.totpService.relaySeed(userId);
  }
}
