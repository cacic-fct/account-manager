import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { M2M_USER_ROLES } from '@cacic/m2m-contracts';
import { M2MGuard, M2MProtected, RequireRoles } from '../auth/jwt/m2m.guard';
import {
  M2MUserEnrollmentLookupDto,
  M2MUserEnrollmentLookupResponseDto,
  M2MUserIdentifierLookupDto,
  M2MUserIdentifierLookupResponseDto,
} from './dto/m2m-user-lookup.dto';
import { M2MUsersService } from './m2m-users.service';

@ApiTags('External API - Users')
@Controller('v1/users')
@UseGuards(M2MGuard)
@M2MProtected()
@RequireRoles(M2M_USER_ROLES.READ)
@ApiBearerAuth()
export class M2MUsersApiController {
  constructor(private readonly users: M2MUsersService) {}

  @Post('enrollment-lookup')
  @ApiOperation({
    summary: 'Lookup Keycloak users by enrollment number',
    description:
      'Returns fresh Keycloak user data for exact enrollment-number matches. Requires M2M authentication with the users:read role. Unmatched enrollment numbers are omitted.',
  })
  @ApiBody({ type: M2MUserEnrollmentLookupDto })
  @ApiResponse({
    status: 200,
    description: 'Matched users returned successfully.',
    type: M2MUserEnrollmentLookupResponseDto,
  })
  async lookupByEnrollmentNumbers(
    @Body() body: M2MUserEnrollmentLookupDto,
  ): Promise<M2MUserEnrollmentLookupResponseDto> {
    return {
      users: await this.users.lookupByEnrollmentNumbers(body.enrollmentNumbers),
    };
  }

  @Post('identifier-lookup')
  @ApiOperation({
    summary: 'Lookup Keycloak users by private identifier',
    description:
      'Returns fresh Keycloak user data for exact CPF, phone, or email matches. Requires M2M authentication with the users:read role. Unmatched identifiers and their values are omitted.',
  })
  @ApiBody({ type: M2MUserIdentifierLookupDto })
  @ApiResponse({
    status: 200,
    description: 'Matched users returned successfully.',
    type: M2MUserIdentifierLookupResponseDto,
  })
  async lookupByIdentifiers(
    @Body() body: M2MUserIdentifierLookupDto,
  ): Promise<M2MUserIdentifierLookupResponseDto> {
    return {
      users: await this.users.lookupByIdentifiers(body.identifiers),
    };
  }
}
