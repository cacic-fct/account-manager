import {
  PERMISSION_GROUP_CATALOG,
  PermissionGroupMembershipCreateRequest,
  PermissionGroupMembershipUpdateRequest,
  PermissionGroupRoleGrantUpdateRequest,
  PermissionGroupKey,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
} from '@cacic/shared-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsISO8601, IsOptional, IsString, MinLength } from 'class-validator';

const permissionGroups = PERMISSION_GROUP_CATALOG.map((definition) => definition.key);

export class KeycloakPermissionGrantCreateDto implements KeycloakPermissionGrantCreateRequest {
  @ApiProperty({
    description: 'Keycloak user id that will receive the direct role grant.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString({ message: 'Selecione uma pessoa válida.' })
  @MinLength(1, { message: 'Selecione uma pessoa.' })
  userId!: string;

  @ApiProperty({
    description: 'Canonical client role id in the form clientId:roleName.',
    example: 'cacic-account-manager:permission-grant#read',
  })
  @IsString({ message: 'Selecione uma permissão válida.' })
  @MinLength(3, { message: 'Selecione uma permissão válida.' })
  permission!: string;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de início: informe uma data e hora válidas.' })
  validFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de término: informe uma data e hora válidas.' })
  validUntil?: string | null;
}

export class KeycloakPermissionGrantUpdateDto implements KeycloakPermissionGrantUpdateRequest {
  @ApiPropertyOptional({
    description: 'Canonical client role id in the form clientId:roleName.',
    example: 'cacic-account-manager:permission-grant#read',
  })
  @IsOptional()
  @IsString({ message: 'Selecione uma permissão válida.' })
  @MinLength(3, { message: 'Selecione uma permissão válida.' })
  permission?: string;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de início: informe uma data e hora válidas.' })
  validFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de término: informe uma data e hora válidas.' })
  validUntil?: string | null;
}

export class PermissionGroupRoleGrantUpdateDto implements PermissionGroupRoleGrantUpdateRequest {
  @ApiProperty({
    isArray: true,
    description: 'Canonical client role ids that should remain enabled for the group.',
    example: ['cacic-account-manager:permission-grant#read', 'cacic-event-manager:event#read'],
  })
  @IsArray({ message: 'Selecione as permissões na lista.' })
  @ArrayUnique({ message: 'Remova as permissões repetidas.' })
  @IsString({ each: true, message: 'Selecione apenas permissões válidas.' })
  permissions!: string[];
}

export class PermissionGroupMembershipCreateDto implements PermissionGroupMembershipCreateRequest {
  @ApiProperty({
    description: 'Keycloak user id that will join the managed group.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString({ message: 'Selecione uma pessoa válida.' })
  @MinLength(1, { message: 'Selecione uma pessoa.' })
  userId!: string;

  @ApiProperty({
    enum: permissionGroups,
    description: 'Managed permission group.',
    example: PermissionGroupKey.Cacic,
  })
  @IsIn(permissionGroups, { message: 'Grupo: selecione uma das opções disponíveis.' })
  groupKey!: PermissionGroupMembershipCreateRequest['groupKey'];

  @ApiProperty({
    description: 'Membership start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601({}, { message: 'Data de início: informe uma data e hora válidas.' })
  validFrom!: string;

  @ApiPropertyOptional({
    description: 'Optional membership end timestamp. If omitted, the membership is indefinite.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de término: informe uma data e hora válidas.' })
  validUntil?: string | null;
}

export class PermissionGroupMembershipUpdateDto implements PermissionGroupMembershipUpdateRequest {
  @ApiProperty({
    description: 'Membership start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601({}, { message: 'Data de início: informe uma data e hora válidas.' })
  validFrom!: string;

  @ApiPropertyOptional({
    description: 'Optional membership end timestamp. If omitted, the membership is indefinite.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601({}, { message: 'Data de término: informe uma data e hora válidas.' })
  validUntil?: string | null;
}
