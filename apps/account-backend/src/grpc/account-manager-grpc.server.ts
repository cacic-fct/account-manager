import {
  Metadata,
  Server,
  status,
  type handleUnaryCall,
  type sendUnaryData,
  type ServerUnaryCall,
  type ServiceError,
  type UntypedServiceImplementation,
} from '@grpc/grpc-js';
import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Logger,
  UnauthorizedException,
  type INestApplication,
} from '@nestjs/common';
import {
  M2M_PRIVACY_ROLES,
  M2M_TOTP_ROLES,
  M2M_USER_ROLES,
  createDefaultPrivacySettings,
  type M2MUserIdentifierType,
  type PrivacySettingTypeValue,
} from '@cacic/m2m-contracts';
import { JwtService, type JwtPayload } from '../auth/jwt/jwt.service';
import { M2MUsersService } from '../m2m-users/m2m-users.service';
import {
  M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS,
  M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS,
  M2M_USER_IDENTIFIER_TYPES,
} from '../m2m-users/dto/m2m-user-lookup.dto';
import { PrivacyService } from '../privacy/privacy.service';
import { TotpService } from '../totp/totp.service';
import { loadGrpcServiceDefinition, resolveGrpcProtoPath, resolveGrpcServerCredentials } from './grpc-runtime';

type GrpcRequest = Record<string, unknown>;
type GrpcResponse = Record<string, unknown>;
type Dependencies = {
  jwt: JwtService;
  privacy: PrivacyService;
  totp: TotpService;
  users: M2MUsersService;
};

const logger = new Logger('AccountManagerGrpc');
let grpcServerReady = false;

export function isAccountManagerGrpcReady(): boolean {
  return grpcServerReady;
}

export function setAccountManagerGrpcReady(ready: boolean): void {
  grpcServerReady = ready;
}

export async function startAccountManagerGrpcServer(app: INestApplication): Promise<Server> {
  const server = new Server({
    'grpc.max_receive_message_length': 4 * 1024 * 1024,
    'grpc.max_send_message_length': 4 * 1024 * 1024,
  });
  const service = loadGrpcServiceDefinition(
    resolveGrpcProtoPath('cacic/m2m/account_manager/v1.proto'),
    ['cacic', 'm2m', 'account_manager', 'v1'],
    'AccountManagerM2M',
  );
  server.addService(
    service,
    createAccountManagerGrpcHandlers({
      jwt: app.get(JwtService),
      privacy: app.get(PrivacyService),
      totp: app.get(TotpService),
      users: app.get(M2MUsersService),
    }),
  );
  const bindUrl = process.env.ACCOUNT_MANAGER_GRPC_BIND_URL?.trim() || '127.0.0.1:50051';
  await new Promise<void>((resolve, reject) => {
    server.bindAsync(bindUrl, resolveGrpcServerCredentials(bindUrl), (error) => (error ? reject(error) : resolve()));
  });
  setAccountManagerGrpcReady(true);
  logger.log(`Account Manager M2M gRPC server is listening on ${bindUrl}.`);
  return server;
}

export function createAccountManagerGrpcHandlers(dependencies: Dependencies): UntypedServiceImplementation {
  return {
    recordCookieConsent: unary(async (call) => {
      await authorize(call.metadata, dependencies.jwt, [M2M_PRIVACY_ROLES.WRITE]);
      await dependencies.privacy.recordCookieConsent(requiredString(call.request, 'userId'));
      return { success: true };
    }),
    getPrivacySettings: unary(async (call) => {
      await authorize(call.metadata, dependencies.jwt, [M2M_PRIVACY_ROLES.READ]);
      const userId = requiredString(call.request, 'userId');
      const record = await dependencies.privacy.findUserSettings(userId);
      const settings = record?.settings ?? createDefaultPrivacySettings();
      const lastUpdated = (record?.updatedAt ?? new Date()).toISOString();
      return {
        settings: Object.entries(settings).map(([settingType, enabled]) => ({
          settingType: settingType as PrivacySettingTypeValue,
          enabled: Boolean(enabled),
          lastUpdated,
        })),
      };
    }),
    ensureTotpSeed: unary(async (call) => {
      await authorize(call.metadata, dependencies.jwt, [M2M_TOTP_ROLES.RELAY]);
      return toWireObject(await dependencies.totp.relaySeed(requiredString(call.request, 'userId')));
    }),
    validateTotp: unary(async (call) => {
      const caller = await authorize(call.metadata, dependencies.jwt, [M2M_TOTP_ROLES.VALIDATE]);
      return toWireObject(
        await dependencies.totp.validateCode(
          requiredString(call.request, 'primaryEmail'),
          requiredString(call.request, 'code'),
          dependencies.jwt.getClientId(caller) || 'unknown-grpc-client',
        ),
      );
    }),
    lookupUsersByEnrollment: unary(async (call) => {
      await authorize(call.metadata, dependencies.jwt, [M2M_USER_ROLES.READ]);
      return {
        users: await dependencies.users.lookupByEnrollmentNumbers(
          stringArray(call.request, 'enrollmentNumbers', M2M_USER_ENROLLMENT_LOOKUP_MAX_ITEMS, 64),
        ),
      };
    }),
    lookupUsersByIdentifier: unary(async (call) => {
      await authorize(call.metadata, dependencies.jwt, [M2M_USER_ROLES.READ]);
      const raw = call.request['identifiers'];
      if (!Array.isArray(raw)) throw new BadRequestException('identifiers must be an array.');
      if (raw.length > M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS) {
        throw new BadRequestException(
          `identifiers must contain at most ${M2M_USER_IDENTIFIER_LOOKUP_MAX_ITEMS} items.`,
        );
      }
      const identifiers = raw.map((item) => {
        if (!isRecord(item)) throw new BadRequestException('Each identifier must be an object.');
        const identifierType = requiredString(item, 'identifierType', 16);
        if (!M2M_USER_IDENTIFIER_TYPES.includes(identifierType as M2MUserIdentifierType)) {
          throw new BadRequestException('identifierType must be cpf, phone, or email.');
        }
        return {
          requestId: requiredString(item, 'requestId', 120),
          identifierType: identifierType as M2MUserIdentifierType,
          identifierValue: requiredString(item, 'identifierValue', 320),
        };
      });
      return { users: await dependencies.users.lookupByIdentifiers(identifiers) };
    }),
  };
}

function unary(
  handler: (call: ServerUnaryCall<GrpcRequest, GrpcResponse>) => Promise<GrpcResponse>,
): handleUnaryCall<GrpcRequest, GrpcResponse> {
  return (call: ServerUnaryCall<GrpcRequest, GrpcResponse>, callback: sendUnaryData<GrpcResponse>) => {
    void handler(call).then(
      (response) => callback(null, response),
      (error: unknown) => callback(toServiceError(error), null),
    );
  };
}

async function authorize(metadata: Metadata, jwt: JwtService, requiredRoles: string[]): Promise<JwtPayload> {
  const raw = metadata.get('authorization')[0];
  const header = Buffer.isBuffer(raw) ? raw.toString('utf8') : raw;
  if (typeof header !== 'string') throw new UnauthorizedException('Missing gRPC authorization metadata.');
  const payload = await jwt.validateToken(jwt.extractTokenFromHeader(header));
  if (!jwt.isServiceAccountToken(payload)) throw new ForbiddenException('Token is not a service account token.');
  if (!jwt.isAllowedM2MClient(payload)) throw new ForbiddenException('M2M client is not allowed.');
  const missing = requiredRoles.filter((role) => !jwt.hasRequiredRole(payload, role));
  if (missing.length > 0) throw new ForbiddenException(`Missing required role(s): ${missing.join(', ')}`);
  return payload;
}

function requiredString(value: GrpcRequest, key: string, maxLength = 2048): string {
  const raw = value[key];
  if (typeof raw !== 'string' || !raw.trim()) throw new BadRequestException(`${key} is required.`);
  const normalized = raw.trim();
  if (normalized.length > maxLength) throw new BadRequestException(`${key} is too long.`);
  return normalized;
}

function stringArray(value: GrpcRequest, key: string, maxItems: number, maxItemLength: number): string[] {
  const raw = value[key];
  if (!Array.isArray(raw)) throw new BadRequestException(`${key} must be an array.`);
  if (raw.length > maxItems) throw new BadRequestException(`${key} must contain at most ${maxItems} items.`);
  return raw.map((item, index) => {
    if (typeof item !== 'string' || !item.trim()) {
      throw new BadRequestException(`${key}[${index}] must be a non-empty string.`);
    }
    const normalized = item.trim();
    if (normalized.length > maxItemLength) {
      throw new BadRequestException(`${key}[${index}] is too long.`);
    }
    return normalized;
  });
}

function toWireObject(value: object): GrpcResponse {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, item instanceof Date ? item.toISOString() : item]),
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toServiceError(error: unknown): ServiceError {
  const code = error instanceof HttpException ? grpcStatusForHttpStatus(error.getStatus()) : status.INTERNAL;
  if (!(error instanceof HttpException)) {
    logger.error('Unhandled gRPC request failure', error);
  }
  const details = error instanceof HttpException ? error.message : 'Internal gRPC service error.';
  return Object.assign(new Error(details), { code, details, metadata: new Metadata() });
}

function grpcStatusForHttpStatus(httpStatus: number): status {
  const grpcStatusByHttpStatus: Readonly<Record<number, status>> = {
    [HttpStatus.BAD_REQUEST]: status.INVALID_ARGUMENT,
    [HttpStatus.UNAUTHORIZED]: status.UNAUTHENTICATED,
    [HttpStatus.FORBIDDEN]: status.PERMISSION_DENIED,
    [HttpStatus.NOT_FOUND]: status.NOT_FOUND,
    [HttpStatus.CONFLICT]: status.ALREADY_EXISTS,
    [HttpStatus.REQUEST_TIMEOUT]: status.DEADLINE_EXCEEDED,
    [HttpStatus.GATEWAY_TIMEOUT]: status.DEADLINE_EXCEEDED,
    [HttpStatus.SERVICE_UNAVAILABLE]: status.UNAVAILABLE,
  };
  return grpcStatusByHttpStatus[httpStatus] ?? status.INTERNAL;
}
