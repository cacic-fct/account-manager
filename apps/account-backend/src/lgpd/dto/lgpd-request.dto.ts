import { IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateLgpdRequestDto {
  @ApiProperty({
    description: 'User ID (Keycloak ID)',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  @IsString()
  userId: string;

  @ApiProperty({
    description: 'User email address',
    example: 'joao.silva@unesp.br',
  })
  @IsString()
  email: string;
}

export class LgpdRequestDto {
  @ApiProperty({
    description: 'Unique request identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'User ID who made the request',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  userId: string;

  @ApiProperty({
    description: 'Email address of the requesting user',
    example: 'joao.silva@unesp.br',
  })
  email: string;

  @ApiProperty({
    description: 'Current status of the LGPD request',
    enum: ['pending', 'processing', 'completed', 'failed'],
    example: 'completed',
  })
  status: 'pending' | 'processing' | 'completed' | 'failed';

  @ApiPropertyOptional({
    description: 'Name of the generated data file',
    example: 'dados-lgpd-f5fc286c-2025-06-30T16-59-49-628Z.zip',
  })
  fileName?: string;

  @ApiPropertyOptional({
    description: 'Size of the generated file in bytes',
    example: 2048576,
  })
  fileSize?: number;

  @ApiPropertyOptional({
    description: 'Error message if the request failed',
    example: 'Failed to retrieve user data from external service',
  })
  errorMessage?: string;

  @ApiProperty({
    description: 'Timestamp when the request was created',
    example: '2025-06-30T16:59:49.628Z',
  })
  createdAt: Date;

  @ApiProperty({
    description: 'Timestamp when the request was last updated',
    example: '2025-06-30T17:05:30.128Z',
  })
  updatedAt: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the file was downloaded',
    example: '2025-06-30T18:15:20.456Z',
  })
  downloadedAt?: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the file expires and will be deleted',
    example: '2025-07-07T16:59:49.628Z',
  })
  expiresAt?: Date;
}

export class LgpdRequestListDto {
  @ApiProperty({
    description: 'Unique request identifier',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Current status of the LGPD request',
    enum: ['pending', 'processing', 'completed', 'failed'],
    example: 'completed',
  })
  status: 'pending' | 'processing' | 'completed' | 'failed';

  @ApiProperty({
    description: 'Timestamp when the request was created',
    example: '2025-06-30T16:59:49.628Z',
  })
  createdAt: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the file was downloaded',
    example: '2025-06-30T18:15:20.456Z',
  })
  downloadedAt?: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the file expires and will be deleted',
    example: '2025-07-07T16:59:49.628Z',
  })
  expiresAt?: Date;

  @ApiPropertyOptional({
    description: 'Name of the generated data file',
    example: 'dados-lgpd-f5fc286c-2025-06-30T16-59-49-628Z.zip',
  })
  fileName?: string;

  @ApiPropertyOptional({
    description: 'Size of the generated file in bytes',
    example: 2048576,
  })
  fileSize?: number;
}
