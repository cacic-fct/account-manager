import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Exception thrown when there's a connectivity issue with Keycloak
 */
export class KeycloakConnectionException extends HttpException {
  constructor(message?: string, originalError?: Error) {
    super(
      {
        message: message || 'Unable to connect to authentication service',
        error: 'Keycloak Connection Error',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        originalError: originalError?.message,
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
}
