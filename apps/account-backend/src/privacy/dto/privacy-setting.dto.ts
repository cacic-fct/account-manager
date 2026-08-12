import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsBoolean, IsIn, IsObject, IsOptional, ValidateNested } from 'class-validator';
import {
  BulkUpdatePrivacySettingsByType,
  M2MBulkPrivacySettingsRequest,
  M2MPrivacySettingResponse,
  M2MPrivacySettingUpdate,
  PrivacyMetadata,
  PrivacySettingRecord,
  PrivacySettingUpdate,
  PrivacySettings,
  PRIVACY_SETTING_TYPE_VALUES,
  PrivacySettingTypeValue,
} from '@cacic/m2m-contracts';

export class UpdatePrivacySettingDto implements PrivacySettingUpdate {
  @ApiProperty({
    description: 'Whether the setting is enabled',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'Additional metadata for the setting',
    required: false,
    example: { source: 'user_action', timestamp: '2024-01-01T00:00:00Z' },
  })
  @IsOptional()
  @IsObject()
  metadata?: PrivacyMetadata;
}

export class BulkUpdatePrivacySettingsDto implements BulkUpdatePrivacySettingsByType {
  @ApiProperty({
    description: 'Analytics tracking setting',
    required: false,
    type: () => UpdatePrivacySettingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePrivacySettingDto)
  analytics_tracking?: UpdatePrivacySettingDto;

  @ApiProperty({
    description: 'Error debugging and reporting setting',
    required: false,
    type: () => UpdatePrivacySettingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePrivacySettingDto)
  error_debugging?: UpdatePrivacySettingDto;

  @ApiProperty({
    description: 'Cookie banner acceptance',
    required: false,
    type: () => UpdatePrivacySettingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePrivacySettingDto)
  cookie_banner_accepted?: UpdatePrivacySettingDto;

  @ApiProperty({
    description: 'Performance monitoring setting',
    required: false,
    type: () => UpdatePrivacySettingDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdatePrivacySettingDto)
  performance_monitoring?: UpdatePrivacySettingDto;
}

export class PrivacySettingResponseDto implements PrivacySettingRecord {
  @ApiProperty({
    description: 'Setting ID',
    example: 'f5fc286c-2025-4567-8901-234567890abc',
  })
  id!: string;

  @ApiProperty({
    description: 'User ID',
    example: 'user-123',
  })
  userId!: string;

  @ApiProperty({
    description: 'Privacy settings as JSONB object',
    example: {
      analytics_tracking: true,
      error_debugging: true,
      performance_monitoring: true,
      cookie_banner_accepted: false,
    },
    type: () => Object,
  })
  settings!: PrivacySettings;

  @ApiProperty({
    description: 'Additional metadata for the settings',
    required: false,
    example: { source: 'user_action', lastUpdated: '2024-01-01T00:00:00Z' },
    type: () => Object,
  })
  metadata?: PrivacyMetadata;

  @ApiProperty({
    description: 'When the settings were created',
    example: '2024-01-01T00:00:00Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'When the settings were last updated',
    example: '2024-01-01T00:00:00Z',
  })
  updatedAt!: Date;
}

// For API endpoints that need setting type and value
export class UpdatePrivacySettingWithTypeDto implements M2MPrivacySettingUpdate {
  @ApiProperty({
    description: 'Type of privacy setting',
    enum: PRIVACY_SETTING_TYPE_VALUES,
    example: 'analytics_tracking',
  })
  @IsIn(PRIVACY_SETTING_TYPE_VALUES)
  settingType!: PrivacySettingTypeValue;

  @ApiProperty({
    description: 'Whether the setting is enabled',
    example: true,
  })
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    description: 'Additional metadata for the setting',
    required: false,
    example: { source: 'user_action', timestamp: '2024-01-01T00:00:00Z' },
  })
  @IsOptional()
  @IsObject()
  metadata?: PrivacyMetadata;
}

export class BulkPrivacySettingsDto implements M2MBulkPrivacySettingsRequest {
  @ApiProperty({
    description: 'List of privacy settings to update',
    type: () => [UpdatePrivacySettingWithTypeDto],
  })
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => UpdatePrivacySettingWithTypeDto)
  settings!: UpdatePrivacySettingWithTypeDto[];
}

// Response DTO for API endpoints
export class ApiPrivacySettingResponseDto implements M2MPrivacySettingResponse {
  @ApiProperty({
    description: 'Setting type',
    enum: PRIVACY_SETTING_TYPE_VALUES,
    example: 'analytics_tracking',
  })
  settingType!: PrivacySettingTypeValue;

  @ApiProperty({
    description: 'Whether the setting is enabled',
    example: true,
  })
  enabled!: boolean;

  @ApiProperty({
    description: 'When the setting was last updated',
    example: '2024-01-01T00:00:00Z',
  })
  lastUpdated!: Date;
}
