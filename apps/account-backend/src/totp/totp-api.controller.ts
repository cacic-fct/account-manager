import { Body, Controller, Param, ParseUUIDPipe, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { M2M_TOTP_ROLES } from '@cacic/m2m-contracts';
import { M2MGuard, M2MProtected, RequireRoles } from '../auth/jwt/m2m.guard';
import { TotpService } from './totp.service';
import { M2MTotpValidateDto, M2MTotpValidateResponseDto, TotpSeedDto } from './dto/totp.dto';
import { SkipCsrf } from '../auth/csrf/csrf.guard';

@ApiTags('External API - TOTP')
@Controller('v1/totp')
@UseGuards(M2MGuard)
@M2MProtected()
@ApiBearerAuth()
@SkipCsrf()
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
    description: 'Validation result. Failed validations do not disclose user existence.',
    type: M2MTotpValidateResponseDto,
  })
  validate(@Body() body: M2MTotpValidateDto, @Req() request: Request): Promise<M2MTotpValidateResponseDto> {
    const caller = request.jwtPayload?.azp || request.jwtPayload?.client_id || request.ip || 'unknown';
    return this.totpService.validateCode(body.primaryEmail, body.code, caller);
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
  ensureSeed(
    @Param('userId', ParseUUIDPipe) userId: string,
    @Res({ passthrough: true }) response: Response,
  ): Promise<TotpSeedDto> {
    response.setHeader('Cache-Control', 'no-store, private');
    response.setHeader('Pragma', 'no-cache');
    return this.totpService.relaySeed(userId);
  }
}
