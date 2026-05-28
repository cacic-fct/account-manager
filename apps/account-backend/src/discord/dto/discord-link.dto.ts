import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional } from 'class-validator';

export class DiscordLinkDto {
  @ApiProperty({
    description: 'Discord link ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'User ID (Keycloak)',
    example: 'f5fc286c-2025-4567-8901-234567890abc',
  })
  userId: string;

  @ApiProperty({
    description: 'Discord user ID',
    example: '123456789012345678',
  })
  discordId: string;

  @ApiProperty({
    description: 'Discord username',
    example: 'user#1234',
  })
  discordUsername: string;

  @ApiProperty({
    description: 'Discord global display name',
    example: 'John Doe',
  })
  discordGlobalName: string;

  @ApiProperty({
    description: 'Discord avatar hash',
    example: 'a1b2c3d4e5f6789012345678',
    required: false,
  })
  discordAvatarHash?: string;

  @ApiProperty({
    description: 'Whether the Discord link is verified',
    example: true,
  })
  isVerified: boolean;

  @ApiProperty({
    description: 'Role assigned in Discord server',
    example: 'Student',
    required: false,
  })
  assignedRole?: string;

  @ApiProperty({
    description: 'Creation date',
    example: '2025-06-30T16:59:49.628Z',
  })
  createdAt: Date;
}

export class LinkDiscordRequestDto {
  @ApiProperty({
    description: 'Discord authorization code',
    example: 'abc123def456',
  })
  @IsString()
  code: string;

  @ApiProperty({
    description: 'State parameter for OAuth security',
    example: 'random-state-string',
  })
  @IsString()
  state: string;
}

export class DiscordLinkStatusDto {
  @ApiProperty({
    description: 'Whether user has linked Discord accounts',
    example: true,
  })
  isLinked: boolean;

  @ApiProperty({
    description: 'List of Discord link information',
    type: [DiscordLinkDto],
    required: false,
  })
  @IsOptional()
  discordLinks?: DiscordLinkDto[];

  @ApiProperty({
    description: 'Server invite link for eligible users',
    required: false,
  })
  @IsOptional()
  inviteLink?: string;

  @ApiProperty({
    description: 'Which role user is eligible for',
    example: false,
  })
  eligibleForRole: 'student' | 'unesp' | 'visitor';
}

export class UnlinkDiscordResponseDto {
  @ApiProperty({
    description: 'Success message',
    example: 'Discord account unlinked successfully',
  })
  message: string;
}

export class UnlinkDiscordRequestDto {
  @ApiProperty({
    description: 'Discord link ID to unlink',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  @IsString()
  linkId: string;
}
