import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { DiscordRoleManagementService } from '../services/discord-role-management.service';
import { Auth, DiscordAdmin } from '../../auth/guards/auth.decorator';
import {
  SelectableRolesDto,
  UpdateRoleSelectionDto,
  UserRoleSelectionDto,
  UserRolesDto,
  RoleSelectionResponseDto,
  DiscordRoleDto,
} from '../dto/discord-roles.dto';

@ApiTags('Discord Role Management')
@Controller('discord/roles')
export class DiscordRoleController {
  constructor(
    private readonly roleManagementService: DiscordRoleManagementService,
  ) {}

  @ApiOperation({
    summary: 'Get all Discord roles for admin management',
    description:
      'Get all Discord roles categorized by permissions for admin management',
  })
  @ApiResponse({
    status: 200,
    description: 'Discord roles returned successfully',
    type: SelectableRolesDto,
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @Get('admin')
  async getSelectableRolesForAdmin(): Promise<SelectableRolesDto> {
    return await this.roleManagementService.getSelectableRolesForAdmin();
  }

  @ApiOperation({
    summary: 'Update role selection configuration',
    description:
      'Update which roles are available for user selection (admin only)',
  })
  @ApiBody({
    type: UpdateRoleSelectionDto,
    description: 'Role selection configuration',
  })
  @ApiResponse({
    status: 200,
    description: 'Role selection updated successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Role selection updated successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @Put('admin/selection')
  async updateRoleSelection(
    @Body() dto: UpdateRoleSelectionDto,
  ): Promise<{ message: string }> {
    await this.roleManagementService.updateRoleSelection(dto);
    return { message: 'Role selection updated successfully' };
  }

  @ApiOperation({
    summary: 'Sync Discord roles from server',
    description: 'Fetch and sync all roles from Discord server (admin only)',
  })
  @ApiResponse({
    status: 200,
    description: 'Roles synced successfully',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Discord roles synced successfully',
        },
      },
    },
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @ApiResponse({
    status: 403,
    description: 'Forbidden - Discord admin role required',
  })
  @DiscordAdmin()
  @Post('admin/sync')
  syncRolesFromDiscord(): { message: string } {
    // Note: This would need access to the Discord client
    // For now, we'll return a success message
    // In a full implementation, you'd inject the Discord client service
    throw new HttpException(
      'Discord client integration required for role sync',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @ApiOperation({
    summary: 'Get selectable roles for users',
    description: 'Get all roles that regular users can select',
  })
  @ApiResponse({
    status: 200,
    description: 'Selectable roles returned successfully',
    type: [DiscordRoleDto],
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('selectable')
  async getSelectableRolesForUser(): Promise<DiscordRoleDto[]> {
    return await this.roleManagementService.getSelectableRolesForUser();
  }

  @ApiOperation({
    summary: "Get user's current Discord roles",
    description: "Get the current user's Discord roles and available roles",
  })
  @ApiResponse({
    status: 200,
    description: 'User roles returned successfully',
    type: UserRolesDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Discord account not linked',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Get('user')
  getUserRoles(): UserRolesDto {
    // Note: This would need access to the Discord client and guild ID
    // For now, we'll throw an error indicating the implementation is needed
    throw new HttpException(
      'Discord client integration required for user role management',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }

  @ApiOperation({
    summary: "Update user's Discord roles",
    description: "Update the current user's selected Discord roles",
  })
  @ApiBody({
    type: UserRoleSelectionDto,
    description: 'User role selection',
  })
  @ApiResponse({
    status: 200,
    description: 'User roles updated successfully',
    type: RoleSelectionResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Discord account not linked or invalid roles',
  })
  @ApiResponse({
    status: 401,
    description: 'Unauthorized - User not authenticated',
  })
  @Auth()
  @Put('user')
  updateUserRoles(): RoleSelectionResponseDto {
    // Note: This would need access to the Discord client and guild ID
    // For now, we'll throw an error indicating the implementation is needed
    throw new HttpException(
      'Discord client integration required for user role management',
      HttpStatus.NOT_IMPLEMENTED,
    );
  }
}
