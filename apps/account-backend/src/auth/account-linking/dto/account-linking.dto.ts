import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString } from 'class-validator';
import type {
  AccountMergeRequest,
  ConfirmAccountMergeRequest,
  ConfirmAccountMergeResponse,
} from '@cacic/shared-types';

export class ConfirmAccountMergeDto implements ConfirmAccountMergeRequest {
  @ApiProperty({
    description: 'Email address that should remain primary after the merge',
    example: 'user@unesp.br',
  })
  @IsEmail()
  primaryEmail!: string;
}

export class AccountLinkingStartUrlDto {
  @ApiProperty({
    description: 'OAuth URL used to authenticate the other Google account',
  })
  @IsString()
  url!: string;
}

export type AccountMergeRequestDto = AccountMergeRequest;
export type ConfirmAccountMergeResponseDto = ConfirmAccountMergeResponse;
