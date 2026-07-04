import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  M2MUserEnrollmentLookupRequest,
  M2MUserEnrollmentLookupResponse,
  M2MUserIdentifierLookupItem,
  M2MUserIdentifierLookupMatch,
  M2MUserIdentifierLookupRequest,
  M2MUserIdentifierLookupResponse,
  M2MUserIdentifierType,
  M2MUserProfile,
} from '@cacic/m2m-contracts';

export const M2M_USER_IDENTIFIER_TYPES = ['cpf', 'phone', 'email'] as const;
export const M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS = 500;
export const M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS = 200;

export class M2MUserEnrollmentLookupDto implements M2MUserEnrollmentLookupRequest {
  @ApiProperty({
    description: 'Enrollment numbers to match exactly against Keycloak users.',
    example: ['24123456', '24234567'],
    maxItems: M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS,
    type: [String],
  })
  @IsArray()
  @ArrayMaxSize(M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS)
  @IsString({ each: true })
  @MaxLength(64, { each: true })
  enrollmentNumbers!: string[];
}

export class M2MUserIdentifierLookupItemDto implements M2MUserIdentifierLookupItem {
  @ApiProperty({
    description: 'Opaque caller-provided identifier used only to correlate matched users.',
    example: 'member-1',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  requestId!: string;

  @ApiProperty({
    description: 'Identifier type to match exactly.',
    enum: M2M_USER_IDENTIFIER_TYPES,
    example: 'email',
  })
  @IsIn(M2M_USER_IDENTIFIER_TYPES)
  identifierType!: M2MUserIdentifierType;

  @ApiProperty({
    description: 'Identifier value. Unmatched values are never echoed back.',
    example: 'ana.souza@unesp.br',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(320)
  identifierValue!: string;
}

export class M2MUserIdentifierLookupDto implements M2MUserIdentifierLookupRequest {
  @ApiProperty({
    description: 'Private identifiers to match against Keycloak users.',
    maxItems: M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS,
    type: () => [M2MUserIdentifierLookupItemDto],
  })
  @IsArray()
  @ArrayMaxSize(M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS)
  @ValidateNested({ each: true })
  @Type(() => M2MUserIdentifierLookupItemDto)
  identifiers!: M2MUserIdentifierLookupItemDto[];
}

export class M2MUserProfileDto implements M2MUserProfile {
  @ApiProperty({
    description: 'Keycloak subject for the matched user.',
    example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
  })
  userId!: string;

  @ApiPropertyOptional({
    description: 'Enrollment number stored in Keycloak.',
    example: '24123456',
  })
  @IsOptional()
  enrollmentNumber?: string | null;

  @ApiProperty({
    description: 'Display name derived from Keycloak profile data.',
    example: 'Ana Souza',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Primary email stored in Keycloak.',
    example: 'ana.souza@unesp.br',
  })
  @IsOptional()
  email?: string | null;
}

export class M2MUserEnrollmentLookupResponseDto implements M2MUserEnrollmentLookupResponse {
  @ApiProperty({
    description: 'Matched users. Unmatched enrollment numbers are omitted.',
    type: () => [M2MUserProfileDto],
  })
  users!: M2MUserProfileDto[];
}

export class M2MUserIdentifierLookupMatchDto extends M2MUserProfileDto implements M2MUserIdentifierLookupMatch {
  @ApiProperty({
    description: 'Opaque caller-provided identifier for this match.',
    example: 'member-1',
  })
  requestId!: string;
}

export class M2MUserIdentifierLookupResponseDto implements M2MUserIdentifierLookupResponse {
  @ApiProperty({
    description: 'Matched users. Unmatched identifiers are omitted.',
    type: () => [M2MUserIdentifierLookupMatchDto],
  })
  users!: M2MUserIdentifierLookupMatchDto[];
}
