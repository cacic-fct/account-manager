import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, IsUUID } from 'class-validator';
import type {
  AccountMergeRequest,
  AdminCreateAccountMergeRequest,
  ConfirmAccountMergeRequest,
  ConfirmAccountMergeResponse,
} from '@cacic/shared-types';

export class ConfirmAccountMergeDto implements ConfirmAccountMergeRequest {
  @ApiProperty({
    description: 'Email address that should remain primary after the merge',
    example: 'user@unesp.br',
  })
  @IsEmail({}, { message: 'Informe um endereço de e-mail válido para escolher a conta principal.' })
  primaryEmail!: string;
}

export class AccountLinkingStartUrlDto {
  @ApiProperty({
    description: 'OAuth URL used to authenticate the other Google account',
  })
  @IsString()
  url!: string;
}

export class AdminCreateAccountMergeDto implements AdminCreateAccountMergeRequest {
  @ApiProperty({
    description: 'Keycloak id of the first account. It wins only when both accounts have the same merge score.',
    example: '6f81382a-4f5d-4e39-a8af-0f2685b8a987',
  })
  @IsString({ message: 'Informe uma conta válida para iniciar a unificação.' })
  @IsNotEmpty({ message: 'Informe uma conta válida para iniciar a unificação.' })
  @IsUUID(undefined, { message: 'Informe uma conta válida para iniciar a unificação.' })
  requesterUserId!: string;

  @ApiProperty({
    description: 'Keycloak id of the other account to merge.',
    example: 'ee2f238b-afc1-4012-ae23-6f9b604a119e',
  })
  @IsString({ message: 'Informe a outra conta da unificação.' })
  @IsNotEmpty({ message: 'Informe a outra conta da unificação.' })
  @IsUUID(undefined, { message: 'Informe a outra conta da unificação.' })
  candidateUserId!: string;
}

export type AccountMergeRequestDto = AccountMergeRequest;
export type ConfirmAccountMergeResponseDto = ConfirmAccountMergeResponse;
