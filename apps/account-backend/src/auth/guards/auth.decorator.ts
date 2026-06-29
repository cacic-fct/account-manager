import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import { AccountManagerPermission } from '@cacic/shared-types';
import {
  AccountPermissionGuard,
  RequireAccountPermissions,
} from './account-permission.guard';
import { AuthGuard } from './auth.guard';
import { UniversityValidationGuard } from './university-validation.guard';

/**
 * Decorator that combines authentication guard with Swagger cookie auth documentation.
 * Use this on endpoints that require user authentication.
 *
 * This decorator:
 * - Applies the AuthGuard to protect the endpoint
 * - Documents the authentication requirement in Swagger with a lock icon
 * - Uses session cookies for authentication (connect.sid)
 *
 * @example
 * ```typescript
 * @Auth()
 * @Get('profile')
 * async getProfile(@Session() session: AuthSession) {
 *   // endpoint logic
 * }
 * ```
 */
export const Auth = () =>
  applyDecorators(UseGuards(AuthGuard), ApiCookieAuth());

/**
 * Decorator for admin-only endpoints.
 * Combines authentication with admin authorization and Swagger documentation.
 *
 * @example
 * ```typescript
 * @Admin()
 * @Get('admin/users')
 * async getUsers() {
 *   // admin endpoint logic
 * }
 * ```
 */
export const Admin = () =>
  applyDecorators(
    RequireAccountPermissions([
      AccountManagerPermission.DiscordManagementRead,
      AccountManagerPermission.DiscordManagementUpdate,
      AccountManagerPermission.StudentVerificationRead,
      AccountManagerPermission.StudentVerificationReview,
      AccountManagerPermission.StudentVerificationDownload,
      AccountManagerPermission.AccountDeletionRead,
      AccountManagerPermission.AccountDeletionUpdate,
      AccountManagerPermission.PermissionGrantRead,
      AccountManagerPermission.PermissionGrantAssign,
      AccountManagerPermission.PermissionGrantRevoke,
      AccountManagerPermission.PermissionGrantSync,
    ]),
    UseGuards(AccountPermissionGuard),
    ApiCookieAuth(),
  );

export const AccountPermissions = (
  permissions: readonly string[],
  mode: 'any' | 'all' = 'any',
) =>
  applyDecorators(
    RequireAccountPermissions(permissions, mode),
    UseGuards(AccountPermissionGuard),
    ApiCookieAuth(),
  );

/**
 * Decorator for student verification admin endpoints.
 * Combines authentication with student verification admin authorization.
 *
 * @example
 * ```typescript
 * @StudentVerificationAdmin()
 * @Post('admin/verify-student')
 * async verifyStudent() {
 *   // student verification admin logic
 * }
 * ```
 */
export const StudentVerificationAdmin = () =>
  applyDecorators(
    RequireAccountPermissions([
      AccountManagerPermission.StudentVerificationRead,
      AccountManagerPermission.StudentVerificationReview,
      AccountManagerPermission.StudentVerificationDownload,
    ]),
    UseGuards(AccountPermissionGuard),
    ApiCookieAuth(),
  );

/**
 * Decorator for Discord admin endpoints.
 * Combines authentication with Discord admin authorization.
 *
 * @example
 * ```typescript
 * @DiscordAdmin()
 * @Get('discord/admin/settings')
 * async getDiscordSettings() {
 *   // Discord admin logic
 * }
 * ```
 */
export const DiscordAdmin = () =>
  applyDecorators(
    RequireAccountPermissions([
      AccountManagerPermission.DiscordManagementRead,
      AccountManagerPermission.DiscordManagementUpdate,
    ]),
    UseGuards(AccountPermissionGuard),
    ApiCookieAuth(),
  );

/**
 * Decorator for university validation endpoints.
 * Ensures user is authenticated AND has NOT completed university role verification.
 * Access is denied if unespRoleVerified attribute is set to "true".
 *
 * @example
 * ```typescript
 * @UniversityValidation()
 * @Post('university-validation/captcha')
 * async getCaptcha() {
 *   // university validation logic
 * }
 * ```
 */
export const UniversityValidation = () =>
  applyDecorators(UseGuards(UniversityValidationGuard), ApiCookieAuth());
