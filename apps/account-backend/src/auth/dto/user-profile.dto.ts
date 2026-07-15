import { IsString, IsBoolean, IsOptional, IsNotEmpty, MinLength, IsEnum, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { UnespRole } from '@cacic/shared-types';

export class CreateUserProfileDto {
  @ApiProperty({
    description: 'Full name of the user',
    example: 'João Silva Santos',
    minLength: 2,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  fullname!: string;

  @ApiProperty({
    description: 'Phone number in international format',
    example: '+5511999887766',
  })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiPropertyOptional({
    description: 'Student enrollment number (only for Unesp students)',
    example: '12345678',
  })
  @IsOptional()
  @IsString()
  enrollmentNumber?: string;

  @ApiProperty({
    description: 'Identity document (CPF for Brazilians, Passport for foreigners)',
    example: '12345678901',
  })
  @IsString()
  @IsNotEmpty()
  identityDocument!: string;

  @ApiProperty({
    description: 'Whether the user is a foreigner (uses passport instead of CPF)',
    example: false,
  })
  @IsBoolean()
  isForeigner!: boolean;

  @ApiPropertyOptional({
    description: 'Unesp role for university users',
    enum: UnespRole,
    example: UnespRole.ALUNO_GRADUACAO,
  })
  @IsOptional()
  @IsEnum(UnespRole)
  unespRole?: UnespRole;
}

export class UserProfileDto {
  @ApiProperty({
    description: 'Unique user identifier (Keycloak ID)',
    example: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  })
  id!: string;

  @ApiProperty({
    description: 'Username (email address)',
    example: 'joao.silva@unesp.br',
  })
  username!: string;

  @ApiProperty({
    description: 'User email address',
    example: 'joao.silva@unesp.br',
  })
  email!: string;

  @ApiPropertyOptional({
    description: 'Secondary email addresses linked to the same user',
    example: ['joao.silva@gmail.com'],
    type: [String],
  })
  secondaryEmails?: string[];

  @ApiProperty({
    description: 'Full name of the user',
    example: 'João Silva Santos',
  })
  fullname!: string;

  @ApiProperty({
    description: 'Display name from OAuth provider',
    example: 'João Silva',
  })
  displayName!: string;

  @ApiPropertyOptional({
    description: 'Profile picture URL from OAuth provider',
    example: 'https://lh3.googleusercontent.com/a/example.jpg',
  })
  picture?: string;

  @ApiProperty({
    description: 'Phone number in international format',
    example: '+5511999887766',
  })
  phone!: string;

  @ApiPropertyOptional({
    description: 'Student enrollment number (only for Unesp students)',
    example: '12345678',
  })
  enrollmentNumber?: string;

  @ApiProperty({
    description: 'Identity document (CPF for Brazilians, Passport for foreigners)',
    example: '12345678901',
  })
  identityDocument!: string;

  @ApiProperty({
    description: 'Country of passport issuance (required if user is a foreigner) in ISO format',
    example: 'BR',
  })
  passportCountry?: string;

  @ApiProperty({
    description: 'Whether the user is a foreigner (uses passport instead of CPF)',
    example: false,
  })
  isForeigner!: boolean;

  @ApiProperty({
    description: 'Whether the user has completed the onboarding process',
    example: true,
  })
  isOnboarded!: boolean;

  @ApiPropertyOptional({
    description: 'Unesp role for university users',
    enum: UnespRole,
    example: UnespRole.ALUNO_GRADUACAO,
  })
  unespRole?: UnespRole;

  @ApiPropertyOptional({
    description: 'Whether the Unesp role has been verified through document validation',
    example: true,
  })
  unespRoleVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Whether external user has been verified through document validation',
    example: true,
  })
  externalUserVerified?: boolean;

  @ApiPropertyOptional({
    description: 'Whether fullname is locked after external verification (prevents changes)',
    example: false,
  })
  fullNameLocked?: boolean;

  @ApiProperty({
    description: 'Whether the user has admin privileges',
    example: false,
  })
  isAdmin!: boolean;

  @ApiPropertyOptional({
    description: 'List of admin groups the user belongs to',
    example: ['super-admin'],
    type: [String],
  })
  adminGroups?: string[];

  @ApiProperty({
    description: 'Account creation timestamp',
    example: '2023-01-15T10:30:00.000Z',
  })
  createdAt!: Date;

  @ApiProperty({
    description: 'Last update timestamp',
    example: '2023-06-30T14:45:00.000Z',
  })
  updatedAt!: Date;
}

export class AuthStatusDto {
  @ApiProperty({
    description: 'Whether the user is authenticated',
    example: true,
  })
  isAuthenticated!: boolean;

  @ApiProperty({
    description: 'Whether the user has completed onboarding',
    example: true,
  })
  isOnboarded!: boolean;
}

export class PasswordLoginDto {
  @ApiProperty({
    description: 'User email address',
    example: 'aluno@unesp.br',
  })
  @IsEmail()
  email!: string;

  @ApiProperty({
    description: 'User password',
    example: '1',
    minLength: 1,
  })
  @IsString()
  @IsNotEmpty()
  @MinLength(1)
  password!: string;

  @ApiPropertyOptional({
    description: 'Optional post-login return URL. Must be a relative path or allowed origin.',
    example: '/applications',
  })
  @IsOptional()
  @IsString()
  returnTo?: string;
}

export class PasswordLoginResponseDto extends AuthStatusDto {
  @ApiProperty({
    description: 'Whether the password login completed successfully',
    example: true,
  })
  success!: boolean;

  @ApiProperty({
    description: 'Validated frontend URL the client should navigate to',
    example: 'http://localhost:4200/applications',
  })
  redirectUrl!: string;
}

export class OnboardingStatusDto {
  @ApiProperty({
    description: 'Whether the user needs to complete onboarding',
    example: false,
  })
  needsOnboarding!: boolean;

  @ApiProperty({
    description: 'List of missing required fields',
    example: ['phone', 'identityDocument'],
    type: [String],
  })
  missingFields!: string[];
}

export class UnespRoleRequiredDto {
  @ApiProperty({
    description: 'Whether the user should see Unesp role selection',
    example: true,
  })
  shouldShowUnespRoleSelection!: boolean;
}

export class UserApplicationDto {
  @ApiProperty({
    description: 'Application unique identifier',
    example: 'app-123',
  })
  id!: string;

  @ApiProperty({
    description: 'Application name',
    example: 'Portal do Aluno',
  })
  name!: string;

  @ApiPropertyOptional({
    description: 'Application description',
    example: 'Portal for student academic services',
  })
  description?: string;

  @ApiPropertyOptional({
    description: 'Application URL',
    example: 'https://portal.unesp.br',
  })
  url?: string;

  @ApiPropertyOptional({
    description: 'Application icon URL',
    example: '/app/assets/portal-icon.svg',
  })
  iconUrl?: string;

  @ApiPropertyOptional({
    description: 'Application category',
    example: 'Academic',
  })
  category?: string;

  @ApiProperty({
    description: 'Whether the application is enabled for the user',
    example: true,
  })
  enabled!: boolean;
}

export class LogoutResponseDto {
  @ApiProperty({
    description: 'Whether the logout was successful',
    example: true,
  })
  success!: boolean;

  @ApiPropertyOptional({
    description: 'Keycloak end-session URL that the browser should visit after local session cleanup.',
    example:
      'https://sso.cacic.com.br/realms/cacic-sso/protocol/openid-connect/logout?client_id=cacic-account-manager&post_logout_redirect_uri=https%3A%2F%2Faccount.cacic.com.br%2Fapp%2F',
  })
  logoutUrl?: string;
}

export class LogoutRequestDto {
  @ApiPropertyOptional({
    description: 'Post-logout redirect URI accepted by the configured Keycloak client.',
    example: 'https://account.cacic.com.br/app/',
  })
  @IsOptional()
  @IsString()
  postLogoutRedirectUri?: string;
}
