import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request } from 'express';
import { JwtService, JwtPayload } from './jwt.service';

export const REQUIRED_ROLES_KEY = 'requiredRoles';
export const REQUIRED_CLIENT_KEY = 'requiredClient';
export const IS_M2M_PROTECTED_KEY = 'isM2MProtected';

export const RequireRoles = (...roles: string[]) => SetMetadata(REQUIRED_ROLES_KEY, roles);

export const RequireClient = (clientId: string) => SetMetadata(REQUIRED_CLIENT_KEY, clientId);

export const M2MProtected = () => SetMetadata(IS_M2M_PROTECTED_KEY, true);

declare module 'express-serve-static-core' {
  interface Request {
    jwtPayload?: JwtPayload;
  }
}

@Injectable()
export class M2MGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isM2MProtected = this.reflector.getAllAndOverride<boolean>(IS_M2M_PROTECTED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!isM2MProtected) {
      return true; // Not protected, allow access
    }

    const request = context.switchToHttp().getRequest<Request>();
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      throw new UnauthorizedException('Authorization header missing');
    }

    try {
      const token = this.jwtService.extractTokenFromHeader(authHeader);
      const payload = await this.jwtService.validateToken(token);

      // Attach payload to request for later use
      request.jwtPayload = payload;

      if (!this.jwtService.isServiceAccountToken(payload)) {
        throw new ForbiddenException('Token is not a service account token');
      }

      if (!this.jwtService.isAllowedM2MClient(payload)) {
        throw new ForbiddenException(`M2M client is not allowed: ${this.jwtService.getClientId(payload) || 'unknown'}`);
      }

      // Check required M2M roles against the configured receiver audience.
      const requiredRoles = this.reflector.getAllAndOverride<string[]>(REQUIRED_ROLES_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (requiredRoles && requiredRoles.length > 0) {
        const hasAllRequiredRoles = requiredRoles.every((role) => this.jwtService.hasRequiredRole(payload, role));

        if (!hasAllRequiredRoles) {
          const missingRoles = requiredRoles.filter((role) => !this.jwtService.hasRequiredRole(payload, role));
          throw new ForbiddenException(`Missing required role(s): ${missingRoles.join(', ')}`);
        }
      }

      // Check required client
      const requiredClient = this.reflector.getAllAndOverride<string>(REQUIRED_CLIENT_KEY, [
        context.getHandler(),
        context.getClass(),
      ]);

      if (requiredClient && !this.jwtService.isFromClient(payload, requiredClient)) {
        throw new ForbiddenException(`Access denied for client: ${payload.azp || payload.client_id || 'unknown'}`);
      }

      return true;
    } catch (error) {
      // Re-throw ForbiddenException as-is (authorization failures)
      if (error instanceof ForbiddenException) {
        throw error;
      }
      // Re-throw UnauthorizedException as-is (authentication failures)
      if (error instanceof UnauthorizedException) {
        throw error;
      }
      // Any other error is treated as authentication failure
      throw new UnauthorizedException('Token validation failed');
    }
  }
}
