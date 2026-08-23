import {
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Body,
  HttpException,
  HttpStatus,
  Session,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBody, ApiResponse } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { DiscordRoleManagementService } from '../services/discord-role-management.service';
import { DiscordManagedRoleOverridesService } from '../services/discord-managed-role-overrides.service';
import { DiscordRoleService } from '../services/discord-role.service';
import { DiscordBotService } from '../discord-bot.service';
import { DiscordClientService } from '../services/discord-client.service';
import { CooldownService } from '../../common/services/cooldown.service';
import { AccountPermissions, Auth } from '../../auth/guards/auth.decorator';
import { AuthSession } from '../../auth/auth.controller';
import { CsrfGuard } from '../../auth/csrf/csrf.guard';
import { AccountManagerPermission } from '@cacic/shared-types';
import {
  SelectableRolesDto,
  UpdateRoleSelectionDto,
  UserRoleSelectionDto,
  UserRolesDto,
  RoleSelectionResponseDto,
  DiscordRoleDto,
} from '../dto/discord-roles.dto';
import {
  DiscordManagedRoleDefinitionDto,
  DiscordManagedRoleOverrideCreateDto,
  DiscordManagedRoleOverrideDto,
  DiscordManagedRoleOverrideUpdateDto,
} from '../dto/discord-managed-role-overrides.dto';

@ApiTags('Discord Role Management')
@Controller('discord/roles')
export class DiscordRoleController {
  constructor(
    private readonly roleManagementService: DiscordRoleManagementService,
    private readonly managedRoleOverridesService: DiscordManagedRoleOverridesService,
    private readonly discordRoleService: DiscordRoleService,
    private readonly discordBotService: DiscordBotService,
    private readonly discordClientService: DiscordClientService,
    private readonly configService: ConfigService,
    private readonly cooldownService: CooldownService,
  ) {}

  @ApiOperation({
    summary: 'Get all Discord roles for admin management',
    description: 'Get all Discord roles categorized by permissions for admin management',
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
    description: 'Forbidden - Discord admin permission required',
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementRead])
  @Get('admin')
  async getSelectableRolesForAdmin(): Promise<SelectableRolesDto> {
    return await this.roleManagementService.getSelectableRolesForAdmin();
  }

  @ApiOperation({
    summary: 'Update role selection configuration',
    description: 'Update which roles are available for user selection (admin only)',
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
    description: 'Forbidden - Discord admin permission required',
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementUpdate])
  @UseGuards(CsrfGuard)
  @Put('admin/selection')
  async updateRoleSelection(@Body() dto: UpdateRoleSelectionDto): Promise<{ message: string }> {
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
    description: 'Forbidden - Discord admin permission required',
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementUpdate])
  @UseGuards(CsrfGuard)
  @Post('admin/sync')
  async syncRolesFromDiscord(): Promise<{ message: string }> {
    try {
      const client = this.discordClientService.getClient();
      const guildId = this.configService.get<string>('DISCORD_GUILD_ID');

      if (!guildId) {
        throw new HttpException('Discord guild ID not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      await this.roleManagementService.syncRolesFromDiscord(client, guildId);
      return { message: 'Discord roles synced successfully' };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new HttpException(`Failed to sync Discord roles: ${errorMessage}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @ApiOperation({
    summary: 'List hardcoded Discord managed role categories',
    description: 'Returns the automated Discord role categories that can be forced by an admin override.',
  })
  @ApiResponse({
    status: 200,
    description: 'Managed Discord role categories returned successfully',
    type: [DiscordManagedRoleDefinitionDto],
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementRead])
  @Get('admin/managed-role-overrides/catalog')
  getManagedRoleOverrideCatalog(): DiscordManagedRoleDefinitionDto[] {
    return this.managedRoleOverridesService.getManagedRoleCatalog();
  }

  @ApiOperation({
    summary: 'List Discord managed role overrides',
    description: 'Returns users whose automated Discord role category is overridden by an admin.',
  })
  @ApiResponse({
    status: 200,
    description: 'Managed Discord role overrides returned successfully',
    type: [DiscordManagedRoleOverrideDto],
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementRead])
  @Get('admin/managed-role-overrides')
  async listManagedRoleOverrides(): Promise<DiscordManagedRoleOverrideDto[]> {
    return this.managedRoleOverridesService.listOverrides();
  }

  @ApiOperation({
    summary: 'Create or replace a Discord managed role override',
    description: 'Creates one active override for a Keycloak user and immediately resyncs linked Discord accounts.',
  })
  @ApiBody({ type: DiscordManagedRoleOverrideCreateDto })
  @ApiResponse({
    status: 201,
    description: 'Managed Discord role override saved successfully',
    type: DiscordManagedRoleOverrideDto,
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementUpdate])
  @UseGuards(CsrfGuard)
  @Post('admin/managed-role-overrides')
  async createManagedRoleOverride(
    @Body() dto: DiscordManagedRoleOverrideCreateDto,
    @Session() session: AuthSession,
  ): Promise<DiscordManagedRoleOverrideDto> {
    const override = await this.managedRoleOverridesService.createOverride(dto, session.user?.keycloakId);
    await this.discordRoleService.syncUserDiscordRoles(override.userId, 'admin-discord-managed-role-override-updated');

    return override;
  }

  @ApiOperation({
    summary: 'Update a Discord managed role override',
    description: 'Updates the forced role category or reason and immediately resyncs linked Discord accounts.',
  })
  @ApiBody({ type: DiscordManagedRoleOverrideUpdateDto })
  @ApiResponse({
    status: 200,
    description: 'Managed Discord role override updated successfully',
    type: DiscordManagedRoleOverrideDto,
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementUpdate])
  @UseGuards(CsrfGuard)
  @Put('admin/managed-role-overrides/:id')
  async updateManagedRoleOverride(
    @Param('id') id: string,
    @Body() dto: DiscordManagedRoleOverrideUpdateDto,
    @Session() session: AuthSession,
  ): Promise<DiscordManagedRoleOverrideDto> {
    const override = await this.managedRoleOverridesService.updateOverride(id, dto, session.user?.keycloakId);
    await this.discordRoleService.syncUserDiscordRoles(override.userId, 'admin-discord-managed-role-override-updated');

    return override;
  }

  @ApiOperation({
    summary: 'Delete a Discord managed role override',
    description: 'Removes a forced Discord role category and immediately resyncs linked Discord accounts.',
  })
  @ApiResponse({
    status: 200,
    description: 'Managed Discord role override deleted successfully',
    schema: {
      type: 'object',
      properties: {
        deleted: { type: 'boolean', example: true },
        id: { type: 'string' },
        userId: { type: 'string' },
      },
    },
  })
  @AccountPermissions([AccountManagerPermission.DiscordManagementUpdate])
  @UseGuards(CsrfGuard)
  @Delete('admin/managed-role-overrides/:id')
  async deleteManagedRoleOverride(@Param('id') id: string): Promise<{ deleted: true; id: string; userId: string }> {
    const result = await this.managedRoleOverridesService.deleteOverride(id);
    await this.discordRoleService.syncUserDiscordRoles(result.userId, 'admin-discord-managed-role-override-removed');

    return result;
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
  async getUserRoles(@Session() session: AuthSession): Promise<UserRolesDto> {
    try {
      // Check if user is authenticated
      if (!session?.user?.keycloakId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const userId: string = session.user.keycloakId;
      const client = this.discordClientService.getClient();
      const guildId = this.configService.get<string>('DISCORD_GUILD_ID');

      if (!guildId) {
        throw new HttpException('Discord guild ID not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      return await this.roleManagementService.getUserRoles(userId, client, guildId);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new HttpException(`Failed to get user roles: ${errorMessage}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
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
  @ApiResponse({
    status: 429,
    description: 'Too Many Requests - User is on cooldown',
    schema: {
      type: 'object',
      properties: {
        message: {
          type: 'string',
          example: 'Too many attempts. Please wait 8s before trying again.',
        },
        attempts: {
          type: 'number',
          example: 3,
        },
        cooldownSeconds: {
          type: 'number',
          example: 8,
        },
      },
    },
  })
  @Auth()
  @UseGuards(CsrfGuard)
  @Put('user')
  async updateUserRoles(
    @Body() dto: UserRoleSelectionDto,
    @Session() session: AuthSession,
  ): Promise<RoleSelectionResponseDto> {
    try {
      // Check if user is authenticated
      if (!session?.user?.keycloakId) {
        throw new HttpException('User not authenticated', HttpStatus.UNAUTHORIZED);
      }

      const userId: string = session.user.keycloakId;
      const action = 'updateRoles';

      // Check cooldown
      if (await this.cooldownService.isOnCooldown(userId, action)) {
        const remainingSeconds = await this.cooldownService.getRemainingCooldown(userId, action);
        const attempts = await this.cooldownService.getAttempts(userId, action);

        throw new HttpException(
          {
            message: `Too many attempts. Please wait ${remainingSeconds}s before trying again.`,
            attempts,
            cooldownSeconds: remainingSeconds,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const client = this.discordClientService.getClient();
      const guildId = this.configService.get<string>('DISCORD_GUILD_ID');

      if (!guildId) {
        throw new HttpException('Discord guild ID not configured', HttpStatus.INTERNAL_SERVER_ERROR);
      }

      try {
        const result = await this.roleManagementService.updateUserRoles(userId, dto, client, guildId);

        // Clear cooldown on successful update
        await this.cooldownService.clearCooldown(userId, action);

        return result;
      } catch (updateError) {
        // Set cooldown on failure
        const cooldownEntry = await this.cooldownService.setCooldown(userId, action);
        const cooldownSeconds = Math.pow(2, cooldownEntry.attempts);

        // If it's a validation error or similar, don't mask the original error
        // Just add cooldown information
        if (updateError instanceof HttpException) {
          if (updateError.getStatus() === 400) {
            // For validation errors, throw the original error but still apply cooldown
            throw updateError;
          }
        }

        // For other errors, include cooldown information
        throw new HttpException(
          {
            message: updateError instanceof Error ? updateError.message : 'Failed to update Discord roles',
            attempts: cooldownEntry.attempts,
            cooldownSeconds,
          },
          updateError instanceof HttpException ? updateError.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } catch (error) {
      // Re-throw if it's already an HttpException with proper formatting
      if (error instanceof HttpException) {
        throw error;
      }

      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      throw new HttpException(`Failed to update user roles: ${errorMessage}`, HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
