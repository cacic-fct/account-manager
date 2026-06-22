import {
  AssignableKeycloakPermission,
  KEYCLOAK_PERMISSION_CATALOG,
  STUDENT_ENTITY_CATALOG,
  KeycloakPermissionGrantCreateRequest,
  KeycloakPermissionGrantUpdateRequest,
  StudentEntityMembershipCreateRequest,
  StudentEntityMembershipUpdateRequest,
} from '@cacic/shared-types';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayUnique,
  IsIn,
  IsISO8601,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
} from 'class-validator';

const assignablePermissions = KEYCLOAK_PERMISSION_CATALOG.map(
  (definition) => definition.permission,
);
const studentEntities = STUDENT_ENTITY_CATALOG.map(
  (definition) => definition.key,
);

export class KeycloakPermissionGrantCreateDto implements KeycloakPermissionGrantCreateRequest {
  @ApiProperty({
    description: 'Keycloak user id that will receive the permission.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({
    enum: assignablePermissions,
    description: 'Allowed Keycloak permission scope to grant.',
    example: AssignableKeycloakPermission.EventManagerAccess,
  })
  @IsIn(assignablePermissions)
  permission!: AssignableKeycloakPermission;

  @ApiPropertyOptional({
    description:
      'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @ApiPropertyOptional({
    description:
      'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}

export class KeycloakPermissionGrantUpdateDto implements KeycloakPermissionGrantUpdateRequest {
  @ApiPropertyOptional({
    description:
      'Optional ISO-8601 start timestamp. If omitted, the grant is active immediately.',
    example: '2026-06-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validFrom?: string | null;

  @ApiPropertyOptional({
    description:
      'Optional ISO-8601 end timestamp. If omitted, the grant is indefinite.',
    example: '2026-07-21T12:00:00.000Z',
    nullable: true,
  })
  @IsOptional()
  @IsISO8601()
  validUntil?: string | null;
}

export class StudentEntityMembershipCreateDto implements StudentEntityMembershipCreateRequest {
  @ApiProperty({
    description: 'Keycloak user id that will receive the mandate membership.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString()
  @MinLength(1)
  userId!: string;

  @ApiProperty({
    enum: studentEntities,
    description: 'Student entity managed by CACiC.',
    example: 'CACIC',
  })
  @IsIn(studentEntities)
  entity!: StudentEntityMembershipCreateRequest['entity'];

  @ApiProperty({
    description: 'Mandate start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  mandateStart!: string;

  @ApiProperty({
    description: 'Mandate end timestamp.',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsISO8601()
  mandateEnd!: string;

  @ApiProperty({
    enum: assignablePermissions,
    isArray: true,
    description: 'Specific Keycloak scopes granted to this member.',
    example: [
      AssignableKeycloakPermission.AccountManagerAccess,
      AssignableKeycloakPermission.EventManagerAccess,
    ],
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(assignablePermissions, { each: true })
  permissions!: StudentEntityMembershipCreateRequest['permissions'];
}

export class StudentEntityMembershipUpdateDto implements StudentEntityMembershipUpdateRequest {
  @ApiProperty({
    description: 'Mandate start timestamp.',
    example: '2026-01-01T00:00:00.000Z',
  })
  @IsISO8601()
  mandateStart!: string;

  @ApiProperty({
    description: 'Mandate end timestamp.',
    example: '2026-12-31T23:59:59.000Z',
  })
  @IsISO8601()
  mandateEnd!: string;

  @ApiProperty({
    enum: assignablePermissions,
    isArray: true,
    description: 'Specific Keycloak scopes granted to this member.',
    example: [
      AssignableKeycloakPermission.AccountManagerAccess,
      AssignableKeycloakPermission.EventManagerAccess,
    ],
  })
  @IsArray()
  @ArrayUnique()
  @IsIn(assignablePermissions, { each: true })
  permissions!: StudentEntityMembershipUpdateRequest['permissions'];
}
