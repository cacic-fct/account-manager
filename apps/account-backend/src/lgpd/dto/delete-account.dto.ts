import { IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DeleteAccountRequestDto {
  @ApiProperty({
    description: 'Confirmation text that user wants to delete their account',
    example: 'DELETE',
  })
  @IsString()
  confirmation: string;

  @ApiPropertyOptional({
    description: 'Optional reason for account deletion',
    example: 'No longer need the service',
  })
  @IsOptional()
  @IsString()
  reason?: string;
}

export class DeleteAccountResponseDto {
  @ApiProperty({
    description: 'Message confirming the deletion request',
    example: 'Account deletion request initiated successfully',
  })
  message: string;

  @ApiProperty({
    description: 'Timestamp when the deletion was requested',
    example: '2025-06-30T17:00:00.000Z',
  })
  requestedAt: Date;

  @ApiProperty({
    description: 'Services that will be notified for data deletion',
    example: ['keycloak', 'user-service', 'application-data'],
    isArray: true,
    type: String,
  })
  servicesNotified: string[];

  @ApiProperty({
    description: 'Timestamp when retained data is scheduled for hard deletion',
    example: '2026-06-30T17:00:00.000Z',
  })
  scheduledHardDeleteAt: Date;
}

export class AdminDeleteAccountRequestDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  email: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  reason?: string;

  @ApiPropertyOptional()
  softDeletedAt?: Date;

  @ApiPropertyOptional()
  scheduledHardDeleteAt?: Date;

  @ApiPropertyOptional()
  completedAt?: Date;

  @ApiPropertyOptional()
  errorMessage?: string;

  @ApiProperty()
  createdAt: Date;
}
