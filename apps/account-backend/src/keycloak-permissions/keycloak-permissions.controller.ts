import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Put,
  Query,
  Session,
  UseGuards,
} from '@nestjs/common';
import {
  AccountManagerPermission,
  PermissionGroupKey,
} from '@cacic/shared-types';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AccountPermissions, Auth } from '../auth/guards/auth.decorator';
import { AuthSession } from '../auth/auth.controller';
import { CsrfGuard } from '../auth/csrf/csrf.guard';
import { KeycloakPermissionsService } from './keycloak-permissions.service';
import {
  KeycloakPermissionGrantCreateDto,
  KeycloakPermissionGrantUpdateDto,
  PermissionGroupMembershipCreateDto,
  PermissionGroupMembershipUpdateDto,
  PermissionGroupRoleGrantUpdateDto,
} from './dto/keycloak-permission-grant.dto';

const PERMISSION_READ = [AccountManagerPermission.PermissionGrantRead] as const;
const PERMISSION_ASSIGN = [
  AccountManagerPermission.PermissionGrantAssign,
] as const;
const PERMISSION_REVOKE = [
  AccountManagerPermission.PermissionGrantRevoke,
] as const;
const PERMISSION_ASSIGN_OR_REVOKE = [
  AccountManagerPermission.PermissionGrantAssign,
  AccountManagerPermission.PermissionGrantRevoke,
] as const;
const PERMISSION_SYNC = [AccountManagerPermission.PermissionGrantSync] as const;

@ApiTags('Admin Permissions')
@Controller('admin/permissions')
export class KeycloakPermissionsController {
  constructor(
    private readonly keycloakPermissions: KeycloakPermissionsService,
  ) {}

  @ApiOperation({ summary: 'List assignable Keycloak client roles' })
  @ApiResponse({
    status: 200,
    description: 'Assignable permission catalog returned successfully',
    example: [
      {
        permission: 'cacic-account-manager:permission-grant#read',
        clientId: 'cacic-account-manager',
        clientLabel: 'Conta CACiC',
        roleName: 'permission-grant#read',
        label: 'Ler permissões',
        source: 'keycloak',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('catalog')
  listCatalog() {
    return this.keycloakPermissions.listCatalog();
  }

  @ApiOperation({ summary: 'List managed permission groups' })
  @ApiResponse({
    status: 200,
    description: 'Permission group catalog returned successfully',
    example: [
      {
        key: 'CACIC',
        label: 'CACiC',
        rootLabel: 'Entidades estudantis',
        keycloakGroupPath: '/Entidades estudantis/CACiC',
        discordRoleId: '533900085642133504',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('groups/catalog')
  listPermissionGroups() {
    return this.keycloakPermissions.listPermissionGroups();
  }

  @ApiOperation({ summary: 'List Keycloak role grants enabled for a group' })
  @ApiParam({
    name: 'groupKey',
    description: 'Managed permission group key.',
  })
  @ApiResponse({
    status: 200,
    description: 'Group role grants returned successfully',
    example: [
      {
        id: 'group-grant-1',
        groupKey: 'CACIC',
        clientId: 'cacic-account-manager',
        roleName: 'permission-grant#read',
        permission: 'cacic-account-manager:permission-grant#read',
        source: 'database',
        validFrom: null,
        validUntil: null,
        status: 'active',
        lastSyncedAt: '2026-06-21T12:00:00.000Z',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('groups/:groupKey/role-grants')
  listGroupRoleGrants(@Param('groupKey') groupKey: PermissionGroupKey) {
    return this.keycloakPermissions.listPermissionGroupRoleGrants(groupKey);
  }

  @ApiOperation({ summary: 'Replace Keycloak role grants enabled for a group' })
  @ApiParam({
    name: 'groupKey',
    description: 'Managed permission group key.',
  })
  @ApiResponse({
    status: 200,
    description: 'Group role grants replaced successfully',
    example: [
      {
        id: 'group-grant-1',
        groupKey: 'CACIC',
        clientId: 'cacic-account-manager',
        roleName: 'permission-grant#read',
        permission: 'cacic-account-manager:permission-grant#read',
        source: 'database',
        validFrom: null,
        validUntil: null,
        status: 'active',
      },
    ],
  })
  @AccountPermissions(PERMISSION_ASSIGN_OR_REVOKE)
  @UseGuards(CsrfGuard)
  @Put('groups/:groupKey/role-grants')
  updateGroupRoleGrants(
    @Param('groupKey') groupKey: PermissionGroupKey,
    @Body() input: PermissionGroupRoleGrantUpdateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.updatePermissionGroupRoleGrants(
      groupKey,
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({
    summary: 'Search Keycloak users by name, identity document, or email',
    description:
      'Returns a small Keycloak user picker result set for permission administration. The query can match name, username, identity document, or email.',
  })
  @ApiQuery({
    name: 'query',
    required: true,
    description: 'Name, identity document, or email search term.',
    example: 'alice',
  })
  @ApiResponse({
    status: 200,
    description: 'Matching Keycloak users returned successfully',
    example: [
      {
        id: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
        email: 'alice@example.com',
        username: 'alice',
        fullName: 'Alice Example',
        displayName: 'Alice Example',
        identityDocument: '12345678900',
        enabled: true,
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('users')
  searchUsers(@Query('query') query = '') {
    return this.keycloakPermissions.searchUsers(query);
  }

  @ApiOperation({
    summary: 'List direct permission grants for a Keycloak user',
    description:
      'Lists direct database-backed role grants for one Keycloak user. Group-derived grants are exposed by the membership endpoints.',
  })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak user id.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @ApiResponse({
    status: 200,
    description: 'Direct permission grants returned successfully',
    example: [
      {
        id: 'grant-1',
        userId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
        userEmail: 'alice@example.com',
        userDisplayName: 'Alice Example',
        clientId: 'cacic-account-manager',
        roleName: 'permission-grant#read',
        permission: 'cacic-account-manager:permission-grant#read',
        source: 'direct',
        validFrom: null,
        validUntil: null,
        status: 'active',
        createdAt: '2026-06-21T12:00:00.000Z',
        createdById: 'admin-1',
        updatedAt: '2026-06-21T12:00:00.000Z',
        updatedById: 'admin-1',
        lastSyncedAt: '2026-06-21T12:00:05.000Z',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('users/:userId/grants')
  listUserGrants(@Param('userId') userId: string) {
    return this.keycloakPermissions.listUserGrants(userId);
  }

  @ApiOperation({ summary: 'List managed group memberships for a user' })
  @ApiParam({
    name: 'userId',
    description: 'Keycloak user id.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @ApiResponse({
    status: 200,
    description: 'Managed group memberships returned successfully',
    example: [
      {
        id: 'membership-1',
        groupKey: 'CACIC',
        keycloakGroupId: '5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
        keycloakGroupPath: '/Entidades estudantis/CACiC',
        discordRoleId: '533900085642133504',
        userId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
        userEmail: 'alice@example.com',
        userDisplayName: 'Alice Example',
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        status: 'active',
        createdAt: '2026-06-21T12:00:00.000Z',
        createdById: 'admin-1',
        updatedAt: '2026-06-21T12:00:00.000Z',
        updatedById: 'admin-1',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('users/:userId/group-memberships')
  listUserMemberships(@Param('userId') userId: string) {
    return this.keycloakPermissions.listUserMemberships(userId);
  }

  @ApiOperation({ summary: 'List managed group memberships' })
  @ApiQuery({
    name: 'groupKey',
    required: false,
    description: 'Optional managed permission group key.',
    example: 'CACIC',
  })
  @ApiResponse({
    status: 200,
    description: 'Managed group memberships returned successfully',
    example: [
      {
        id: 'membership-1',
        groupKey: 'CACIC',
        keycloakGroupId: '5470bc10-d4f5-47c7-90cc-a4dd62ecd163',
        keycloakGroupPath: '/Entidades estudantis/CACiC',
        discordRoleId: '533900085642133504',
        userId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
        userEmail: 'alice@example.com',
        userDisplayName: 'Alice Example',
        validFrom: '2026-01-01T00:00:00.000Z',
        validUntil: null,
        status: 'active',
        createdAt: '2026-06-21T12:00:00.000Z',
        createdById: 'admin-1',
        updatedAt: '2026-06-21T12:00:00.000Z',
        updatedById: 'admin-1',
      },
    ],
  })
  @AccountPermissions(PERMISSION_READ)
  @Get('groups/memberships')
  listMemberships(@Query('groupKey') groupKey?: PermissionGroupKey) {
    return this.keycloakPermissions.listPermissionGroupMemberships(groupKey);
  }

  @ApiOperation({
    summary: 'Create a direct Keycloak permission grant',
    description:
      'Creates a direct database-backed permission grant for a Keycloak user and synchronizes the parsed client role to Keycloak.',
  })
  @ApiResponse({
    status: 201,
    description: 'Permission grant created successfully',
    example: {
      id: 'grant-1',
      userId: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
      userEmail: 'alice@example.com',
      userDisplayName: 'Alice Example',
      clientId: 'cacic-account-manager',
      roleName: 'permission-grant#read',
      permission: 'cacic-account-manager:permission-grant#read',
      source: 'direct',
      validFrom: null,
      validUntil: null,
      status: 'active',
      createdAt: '2026-06-21T12:00:00.000Z',
      createdById: 'admin-1',
      updatedAt: '2026-06-21T12:00:00.000Z',
      updatedById: 'admin-1',
      lastSyncedAt: '2026-06-21T12:00:05.000Z',
    },
  })
  @AccountPermissions(PERMISSION_ASSIGN)
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

  @ApiOperation({ summary: 'Create a managed group membership' })
  @ApiResponse({
    status: 201,
    description: 'Managed group membership created successfully',
  })
  @AccountPermissions(PERMISSION_ASSIGN)
  @UseGuards(CsrfGuard)
  @Post('groups/memberships')
  createMembership(
    @Body() input: PermissionGroupMembershipCreateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.createPermissionGroupMembership(
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Update a direct permission grant' })
  @ApiParam({
    name: 'id',
    description: 'Permission grant id.',
  })
  @AccountPermissions(PERMISSION_ASSIGN_OR_REVOKE)
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

  @ApiOperation({ summary: 'Update a managed group membership' })
  @ApiParam({
    name: 'id',
    description: 'Managed group membership id.',
  })
  @AccountPermissions(PERMISSION_ASSIGN_OR_REVOKE)
  @UseGuards(CsrfGuard)
  @Put('groups/memberships/:id')
  updateMembership(
    @Param('id') id: string,
    @Body() input: PermissionGroupMembershipUpdateDto,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.updatePermissionGroupMembership(
      id,
      input,
      session.user?.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Delete a direct permission grant' })
  @ApiParam({
    name: 'id',
    description: 'Permission grant id.',
  })
  @AccountPermissions(PERMISSION_REVOKE)
  @UseGuards(CsrfGuard)
  @Delete('grants/:id')
  async deleteGrant(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<{ deleted: true; id: string }> {
    await this.keycloakPermissions.deleteGrant(id, session.user?.keycloakId);
    return { deleted: true, id };
  }

  @ApiOperation({ summary: 'Delete a managed group membership' })
  @ApiParam({
    name: 'id',
    description: 'Managed group membership id.',
  })
  @AccountPermissions(PERMISSION_REVOKE)
  @UseGuards(CsrfGuard)
  @Delete('groups/memberships/:id')
  async deleteMembership(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ): Promise<{ deleted: true; id: string }> {
    await this.keycloakPermissions.deletePermissionGroupMembership(
      id,
      session.user?.keycloakId,
    );
    return { deleted: true, id };
  }

  @ApiOperation({ summary: 'Queue permission grant synchronization' })
  @ApiResponse({
    status: 202,
    description: 'Permission grant synchronization queued successfully',
    example: { queued: true },
  })
  @AccountPermissions(PERMISSION_SYNC)
  @UseGuards(CsrfGuard)
  @HttpCode(202)
  @Post('sync')
  async sync(): Promise<{ queued: true }> {
    await this.keycloakPermissions.enqueueSync('manual');
    return { queued: true };
  }
}

@ApiTags('User Permissions')
@Controller('permissions')
export class UserPermissionsController {
  constructor(
    private readonly keycloakPermissions: KeycloakPermissionsService,
  ) {}

  @ApiOperation({ summary: 'List current user groups and direct permissions' })
  @Auth()
  @Get('me')
  getSelfServiceAccess(@Session() session: AuthSession) {
    return this.keycloakPermissions.getSelfServiceAccess(
      session.user!.keycloakId,
    );
  }

  @ApiOperation({ summary: 'Remove current user from a managed group' })
  @Auth()
  @UseGuards(CsrfGuard)
  @Delete('me/groups/:id')
  selfRemoveMembership(
    @Param('id') id: string,
    @Session() session: AuthSession,
  ) {
    return this.keycloakPermissions.selfRemoveMembership(
      session.user!.keycloakId,
      id,
    );
  }

  @ApiOperation({ summary: 'Remove a direct permission from current user' })
  @Auth()
  @UseGuards(CsrfGuard)
  @Delete('me/grants/:id')
  selfRemoveGrant(@Param('id') id: string, @Session() session: AuthSession) {
    return this.keycloakPermissions.selfRemoveGrant(
      session.user!.keycloakId,
      id,
    );
  }
}
