import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Session,
  UseGuards,
} from '@nestjs/common';
import { StudentEntityKey } from '@cacic/shared-types';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Admin } from '../auth/guards/auth.decorator';
import { AuthSession } from '../auth/auth.controller';
import { CsrfGuard } from '../auth/csrf/csrf.guard';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import {
  KeycloakPermissionGrantCreateDto,
  KeycloakPermissionGrantUpdateDto,
  StudentEntityMembershipCreateDto,
  StudentEntityMembershipUpdateDto,
} from './dto/keycloak-permission-grant.dto';

@ApiTags('Admin Permissions')
@Controller('admin/permissions')
export class KeycloakPermissionsController {
  constructor(
    private readonly keycloakPermissions: KeycloakPermissionsService,
  ) {}

  @ApiOperation({ summary: 'List assignable Keycloak permissions' })
  @ApiResponse({
    status: 200,
    description: 'Assignable permission catalog returned successfully',
  })
  @Admin()
  @Get('catalog')
  listCatalog() {
    return this.keycloakPermissions.listCatalog();
  }

  @ApiOperation({ summary: 'List managed student entities' })
  @ApiResponse({
    status: 200,
    description: 'Student entity catalog returned successfully',
  })
  @Admin()
  @Get('student-entities/catalog')
  listStudentEntities() {
    return this.keycloakPermissions.listStudentEntities();
  }

  @ApiOperation({
    summary: 'Search Keycloak users by name, identity document, or email',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Name, identity document, or email search term.',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching Keycloak users returned successfully',
  })
  @Admin()
  @Get('users')
  searchUsers(@Query('query') query = '') {
    return this.keycloakPermissions.searchUsers(query);
  }

  @ApiOperation({ summary: 'List permission grants for a Keycloak user' })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak user id.',
  })
  @ApiResponse({
    status: 200,
    description: 'User permission grants returned successfully',
  })
  @Admin()
  @Get('users/:userId/grants')
  listUserGrants(@Param('userId') userId: string) {
    return this.keycloakPermissions.listUserGrants(userId);
  }

  @ApiOperation({ summary: 'List student entity memberships for a user' })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak user id.',
  })
  @ApiResponse({
    status: 200,
    description: 'User student entity memberships returned successfully',
  })
  @Admin()
  @Get('users/:userId/student-entity-memberships')
  listUserMemberships(@Param('userId') userId: string) {
    return this.keycloakPermissions.listUserMemberships(userId);
  }

  @ApiOperation({ summary: 'List student entity memberships' })
  @ApiQuery({
    name: 'entity',
    required: false,
    description: 'Optional student entity key.',
  })
  @ApiResponse({
    status: 200,
    description: 'Student entity memberships returned successfully',
  })
  @Admin()
  @Get('student-entities/memberships')
  listMemberships(@Query('entity') entity?: StudentEntityKey) {
    return this.keycloakPermissions.listStudentEntityMemberships(entity);
  }

  @ApiOperation({ summary: 'Create a Keycloak permission grant' })
  @ApiResponse({
    status: 201,
    description: 'Permission grant created successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Post('grants')
  createGrant(
    @Body() input: KeycloakPermissionGrantCreateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.createGrant(
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Create a student entity mandate membership' })
  @ApiResponse({
    status: 201,
    description: 'Student entity membership created successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Post('student-entities/memberships')
  createMembership(
    @Body() input: StudentEntityMembershipCreateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.createStudentEntityMembership(
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Update a Keycloak permission grant validity' })
  @ApiParam({
    name: 'id',
    description: 'Permission grant id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Permission grant updated successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Put('grants/:id')
  updateGrant(
    @Param('id') id: string,
    @Body() input: KeycloakPermissionGrantUpdateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.updateGrant(
      id,
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Update a student entity mandate membership' })
  @ApiParam({
    name: 'id',
    description: 'Student entity membership id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Student entity membership updated successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Put('student-entities/memberships/:id')
  updateMembership(
    @Param('id') id: string,
    @Body() input: StudentEntityMembershipUpdateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.updateStudentEntityMembership(
      id,
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Delete a Keycloak permission grant' })
  @ApiParam({
    name: 'id',
    description: 'Permission grant id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Permission grant deleted successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Delete('grants/:id')
  async deleteGrant(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<{ deleted: true; id: string }> {
    await this.keycloakPermissions.deleteGrant(id, session.user?.keycloakId);
    return { deleted: true, id };
  }

  @ApiOperation({ summary: 'Delete a student entity mandate membership' })
  @ApiParam({
    name: 'id',
    description: 'Student entity membership id.',
  })
  @ApiResponse({
    status: 200,
    description: 'Student entity membership deleted successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Delete('student-entities/memberships/:id')
  async deleteMembership(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<{ deleted: true; id: string }> {
    await this.keycloakPermissions.deleteStudentEntityMembership(
      id,
      session.user?.keycloakId,
    );
    return { deleted: true, id };
  }

  @ApiOperation({ summary: 'Queue permission grant synchronization' })
  @ApiResponse({
    status: 202,
    description: 'Permission grant synchronization queued successfully',
  })
  @Admin()
  @UseGuards(CsrfGuard)
  @Post('sync')
  async sync(): Promise<{ queued: true }> {
    await this.keycloakPermissions.enqueueSync('manual');
    return { queued: true };
  }
}
