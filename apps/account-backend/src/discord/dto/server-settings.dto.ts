import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class UpdateServerSettingDto {
  @ApiProperty({
    description: 'Setting value',
    example: 'https://discord.gg/abc123',
  })
  @IsString()
  value: string;
}

export class ServerSettingDto {
  @ApiProperty({
    description: 'Setting ID',
    example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890',
  })
  id: string;

  @ApiProperty({
    description: 'Setting key',
    example: 'student_invite_link',
  })
  key: string;

  @ApiProperty({
    description: 'Setting value',
    example: 'https://discord.gg/abc123',
  })
  value: string;

  @ApiProperty({
    description: 'Setting description',
    example: 'Invite link for students',
  })
  description: string;

  @ApiProperty({
    description: 'Last updated',
    example: '2025-06-30T16:59:49.628Z',
  })
  updatedAt: Date;
}
