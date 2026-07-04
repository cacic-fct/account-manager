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
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({
    description: 'Canonical client role id in the form clientId:roleName.',
    example: 'cacic-account-manager:permission-grant#read',
  })
  @IsString()
  @MinLength(3)
  permission!: string;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}

export class KeycloakPermissionGrantUpdateDto implements KeycloakPermissionGrantUpdateRequest {
  @ApiPropertyOptional({
    description: 'Canonical client role id in the form clientId:roleName.',
    example: 'cacic-account-manager:permission-grant#read',
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  permission?: string;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @ApiPropertyOptional({
    description: 'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}

export class PermissionGroupRoleGrantUpdateDto implements PermissionGroupRoleGrantUpdateRequest {
  @ApiProperty({
    isArray: true,
    description: 'Canonical client role ids that should remain enabled for the group.',
    example: ['cacic-account-manager:permission-grant#read', 'cacic-event-manager:event#read'],
  })
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  permissions!: string[];
}

export class PermissionGroupMembershipCreateDto implements PermissionGroupMembershipCreateRequest {
  @ApiProperty({
    description: 'Keycloak user id that will join the managed group.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({
    enum: permissionGroups,
    description: 'Managed permission group.',
    example: PermissionGroupKey.Cacic,
  })
  @IsIn(permissionGroups)
  groupKey!: PermissionGroupMembershipCreateRequest['groupKey'];

  @ApiProperty({
    description: 'Membership start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({
    description: 'Optional membership end timestamp. If omitted, the membership is indefinite.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}

export class PermissionGroupMembershipUpdateDto implements PermissionGroupMembershipUpdateRequest {
  @ApiProperty({
    description: 'Membership start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  validFrom!: string;

  @ApiPropertyOptional({
    description: 'Optional membership end timestamp. If omitted, the membership is indefinite.',
    example: '2026-12-31T23:59:59.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}
