import { applyDecorators, UseGuards } from '@nestjs/common';
import { ApiCookieAuth } from '@nestjs/swagger';
import { ACCOUNT_MANAGER_ADMIN_ROLES } from '../constants/admin-permissions';
import { AuthGuard } from './auth.guard';
import { DiscordAdminGuard } from './discord-admin.guard';
import { KeycloakRoleGuard, RequireKeycloakRoles } from './keycloak-role.guard';
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
    RequireKeycloakRoles(ACCOUNT_MANAGER_ADMIN_ROLES),
    UseGuards(KeycloakRoleGuard),
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
    RequireKeycloakRoles(ACCOUNT_MANAGER_ADMIN_ROLES),
    UseGuards(KeycloakRoleGuard),
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
  applyDecorators(UseGuards(DiscordAdminGuard), ApiCookieAuth());

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
