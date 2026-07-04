import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';
import { TOTP_ALGORITHM, TOTP_DIGITS, TOTP_PERIOD_SECONDS } from '../totp.constants';

export class TotpStatusDto {
  @ApiProperty({
    description: 'Whether the user already has an offline TOTP seed.',
    example: true,
  })
  configured!: boolean;

  @ApiProperty({
    description: 'TOTP HMAC algorithm.',
    example: TOTP_ALGORITHM,
  })
  algorithm!: typeof TOTP_ALGORITHM;

  @ApiProperty({
    description: 'Number of TOTP digits.',
    example: TOTP_DIGITS,
  })
  digits!: typeof TOTP_DIGITS;

  @ApiProperty({
    description: 'TOTP step duration in seconds.',
    example: TOTP_PERIOD_SECONDS,
  })
  periodSeconds!: typeof TOTP_PERIOD_SECONDS;

  @ApiProperty({
    description: 'Server timestamp used to help clients align their countdown.',
    example: '2026-06-26T16:00:00.000Z',
  })
  serverTime!: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the current seed was first created.',
    example: '2026-06-26T16:00:00.000Z',
  })
  createdAt?: Date;

  @ApiPropertyOptional({
    description: 'Timestamp when the current seed was last rotated.',
    example: '2026-06-26T16:00:00.000Z',
  })
  rotatedAt?: Date;
}

export class TotpSeedDto {
  @ApiProperty({
    description: 'Keycloak subject for the user that owns this seed.',
    example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
  })
  userId!: string;

  @ApiProperty({
    description: 'Primary email used with this TOTP during offline operation.',
    example: 'joao.silva@unesp.br',
  })
  primaryEmail!: string;

  @ApiProperty({
    description: 'Base32 TOTP seed. Store only while the authenticated session is active.',
    example: 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP',
  })
  seed!: string;

  @ApiProperty({
    description: 'TOTP HMAC algorithm.',
    example: TOTP_ALGORITHM,
  })
  algorithm!: typeof TOTP_ALGORITHM;

  @ApiProperty({
    description: 'Number of TOTP digits.',
    example: TOTP_DIGITS,
  })
  digits!: typeof TOTP_DIGITS;

  @ApiProperty({
    description: 'TOTP step duration in seconds.',
    example: TOTP_PERIOD_SECONDS,
  })
  periodSeconds!: typeof TOTP_PERIOD_SECONDS;

  @ApiProperty({
    description: 'Server timestamp used to help clients align their countdown.',
    example: '2026-06-26T16:00:00.000Z',
  })
  serverTime!: Date;
}

export class M2MTotpValidateDto {
  @ApiProperty({
    description: 'Primary email provided by the offline user.',
    example: 'joao.silva@unesp.br',
  })
  @IsEmail()
  primaryEmail!: string;

  @ApiProperty({
    description: 'Six digit TOTP code. Spaces are accepted for display grouping.',
    example: '123 456',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[\d\s-]{6,10}$/)
  code!: string;
}

export class M2MTotpValidateResponseDto {
  @ApiProperty({
    description: 'Whether the code matched the current step or one adjacent step.',
    example: true,
  })
  valid!: boolean;

  @ApiProperty({
    description: 'Server timestamp for audit and clock diagnostics.',
    example: '2026-06-26T16:00:00.000Z',
  })
  serverTime!: Date;

  @ApiPropertyOptional({
    description: 'Keycloak subject for the matched user. Present only when valid is true.',
    example: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad',
  })
  userId?: string;

  @ApiPropertyOptional({
    description: 'Canonical primary email for the matched user. Present only when valid is true.',
    example: 'joao.silva@unesp.br',
  })
  primaryEmail?: string;

  @ApiPropertyOptional({
    description: 'Matched validation step offset relative to the current 30 second step.',
    example: 0,
  })
  matchedStepOffset?: -1 | 0 | 1;
}
