import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsString, Matches } from 'class-validator';

const DISCORD_SNOWFLAKE_PATTERN = /^\d{17,20}$/;

export class DiscordRoleDto {
  @ApiProperty({
    description: 'Discord role ID',
    example: '123456789012345678',
  })
  id!: string;

  @ApiProperty({
    description: 'Role name',
    example: 'Developer',
  })
  name!: string;

  @ApiProperty({
    description: 'Role color (hex)',
    example: '#ff0000',
  })
  color!: string;

  @ApiProperty({
    description: 'Role position/hierarchy',
    example: 5,
  })
  position!: number;

  @ApiProperty({
    description: 'Whether the role has dangerous permissions',
    example: false,
  })
  hasPermissions!: boolean;

  @ApiProperty({
    description: 'Whether the role is blacklisted',
    example: false,
  })
  isBlacklisted!: boolean;

  @ApiProperty({
    description: 'Whether the role is enabled for user selection',
    example: true,
  })
  isEnabled!: boolean;

  @ApiProperty({
    description: 'Whether the role is managed by the bot or Discord',
    example: false,
  })
  isManaged!: boolean;
}

export class SelectableRolesDto {
  @ApiProperty({
    description: 'Roles with permissions (admin view only)',
    type: [DiscordRoleDto],
  })
  rolesWithPermissions!: DiscordRoleDto[];

  @ApiProperty({
    description: 'Roles without permissions',
    type: [DiscordRoleDto],
  })
  rolesWithoutPermissions!: DiscordRoleDto[];

  @ApiProperty({
    description: 'All user-selectable roles (user view)',
    type: [DiscordRoleDto],
  })
  selectableRoles!: DiscordRoleDto[];
}

export class UpdateRoleSelectionDto {
  @ApiProperty({
    description: 'Array of role IDs to enable for selection',
    type: [String],
    example: ['123456789012345678', '987654321098765432'],
  })
  @IsArray({ message: 'Selecione os cargos que ficarão disponíveis.' })
  @ArrayMaxSize(100, { message: 'Cargos disponíveis: selecione no máximo 100 cargos.' })
  @ArrayUnique({ message: 'Cargos disponíveis: remova as opções repetidas.' })
  @IsString({ each: true, message: 'Selecione apenas cargos válidos do Discord.' })
  @Matches(DISCORD_SNOWFLAKE_PATTERN, { each: true, message: 'Selecione apenas cargos válidos do Discord.' })
  enabledRoleIds!: string[];
}

export class UserRoleSelectionDto {
  @ApiProperty({
    description: 'Array of role IDs the user wants to have',
    type: [String],
    example: ['123456789012345678', '987654321098765432'],
  })
  @IsArray({ message: 'Selecione os cargos na lista.' })
  @ArrayMaxSize(25, { message: 'Cargos selecionados: selecione no máximo 25 cargos.' })
  @ArrayUnique({ message: 'Cargos selecionados: remova as opções repetidas.' })
  @IsString({ each: true, message: 'Selecione apenas cargos válidos do Discord.' })
  @Matches(DISCORD_SNOWFLAKE_PATTERN, { each: true, message: 'Selecione apenas cargos válidos do Discord.' })
  selectedRoleIds!: string[];
}

export class UserRolesDto {
  @ApiProperty({
    description: "User's current Discord roles",
    type: [DiscordRoleDto],
  })
  currentRoles!: DiscordRoleDto[];

  @ApiProperty({
    description: 'Available roles for selection',
    type: [DiscordRoleDto],
  })
  availableRoles!: DiscordRoleDto[];
}

export class RoleSelectionResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Roles updated successfully',
  })
  message!: string;

  @ApiProperty({
    description: 'Updated user roles',
    type: [DiscordRoleDto],
  })
  updatedRoles!: DiscordRoleDto[];
}
