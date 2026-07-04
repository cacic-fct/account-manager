import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type {
  DiscordManagedRoleCategory,
  DiscordManagedRoleDefinition,
  DiscordManagedRoleOverride,
} from '@cacic/shared-types';

export const DISCORD_MANAGED_ROLE_CATEGORIES = [
  'student',
  'unesp',
  'visitor',
] as const satisfies readonly DiscordManagedRoleCategory[];

export class DiscordManagedRoleDefinitionDto implements DiscordManagedRoleDefinition {
  @ApiProperty({
    description: 'Managed role category used by automated Discord enforcement',
    enum: DISCORD_MANAGED_ROLE_CATEGORIES,
    example: 'student',
  })
  category!: DiscordManagedRoleCategory;

  @ApiProperty({
    description: 'Discord role ID assigned for this category',
    example: '533901504537427968',
  })
  roleId!: string;

  @ApiProperty({
    description: 'Discord role name assigned for this category',
    example: 'Aluno da Computação',
  })
  roleName!: string;

  @ApiProperty({
    description: 'Human-readable category label for admin screens',
    example: 'Aluno da Computação',
  })
  label!: string;

  @ApiProperty({
    description: 'Short explanation of what this automated category means',
    example: 'Força o cargo de aluno mesmo quando os critérios automáticos não batem.',
  })
  description!: string;
}

export class DiscordManagedRoleOverrideDto implements DiscordManagedRoleOverride {
  @ApiProperty({ example: '018ff1f4-22f4-7330-9f2a-8a52fa4a0d84' })
  id!: string;

  @ApiProperty({
    description: 'Keycloak user ID that receives the managed role override',
    example: 'f7be3c57-83c8-4f9b-9a21-e4040c44b84f',
  })
  userId!: string;

  @ApiPropertyOptional({ example: 'aluno@example.com' })
  userEmail?: string;

  @ApiPropertyOptional({ example: 'Fulano de Tal' })
  userDisplayName?: string;

  @ApiProperty({
    enum: DISCORD_MANAGED_ROLE_CATEGORIES,
    example: 'student',
  })
  roleCategory!: DiscordManagedRoleCategory;

  @ApiProperty({ example: 'Aluno da Computação' })
  roleLabel!: string;

  @ApiProperty({ example: '533901504537427968' })
  roleId!: string;

  @ApiProperty({ example: 'Aluno da Computação' })
  roleName!: string;

  @ApiPropertyOptional({
    description: 'Admin-visible reason for the override',
    example: 'Aluno confirmado manualmente pela secretaria.',
  })
  reason?: string;

  @ApiProperty({ example: '2026-07-03T12:00:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({ example: 'admin-keycloak-id' })
  createdById?: string;

  @ApiProperty({ example: '2026-07-03T12:00:00.000Z' })
  updatedAt!: string;

  @ApiPropertyOptional({ example: 'admin-keycloak-id' })
  updatedById?: string;
}

export class DiscordManagedRoleOverrideCreateDto {
  @ApiProperty({
    description: 'Keycloak user ID that receives the override',
    example: 'f7be3c57-83c8-4f9b-9a21-e4040c44b84f',
  })
  @IsString()
  @MaxLength(128)
  userId!: string;

  @ApiProperty({
    enum: DISCORD_MANAGED_ROLE_CATEGORIES,
    example: 'student',
  })
  @IsIn(DISCORD_MANAGED_ROLE_CATEGORIES)
  roleCategory!: DiscordManagedRoleCategory;

  @ApiPropertyOptional({
    description: 'Admin-visible reason for the override',
    example: 'Aluno confirmado manualmente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class DiscordManagedRoleOverrideUpdateDto {
  @ApiPropertyOptional({
    enum: DISCORD_MANAGED_ROLE_CATEGORIES,
    example: 'student',
  })
  @IsOptional()
  @IsIn(DISCORD_MANAGED_ROLE_CATEGORIES)
  roleCategory?: DiscordManagedRoleCategory;

  @ApiPropertyOptional({
    description: 'Admin-visible reason for the override',
    example: 'Aluno confirmado manualmente.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
