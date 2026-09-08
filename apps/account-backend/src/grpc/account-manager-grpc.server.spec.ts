import { Metadata, status, type ServiceError } from '@grpc/grpc-js';
import { UnauthorizedException } from '@nestjs/common';
import { createAccountManagerGrpcHandlers } from './account-manager-grpc.server';

type TestHandler = (
  call: { metadata: Metadata; request: Record<string, unknown> },
  callback: (error: ServiceError | null, response: Record<string, unknown> | null) => void,
) => void;

describe('Account Manager gRPC request boundary', () => {
  const jwt = {
    extractTokenFromHeader: jest.fn().mockReturnValue('token'),
    validateToken: jest.fn().mockResolvedValue({ azp: 'caller' }),
    isServiceAccountToken: jest.fn().mockReturnValue(true),
    isAllowedM2MClient: jest.fn().mockReturnValue(true),
    hasRequiredRole: jest.fn().mockReturnValue(true),
    getClientId: jest.fn().mockReturnValue('caller'),
  };
  const privacy = {
    recordCookieConsent: jest.fn(),
    findUserSettings: jest.fn(),
  };
  const totp = {
    relaySeed: jest.fn(),
    validateCode: jest.fn(),
  };
  const users = {
    lookupByEnrollmentNumbers: jest.fn(),
    lookupByIdentifiers: jest.fn(),
  };

  beforeEach(() => jest.clearAllMocks());

  const invoke = (method: string, request: Record<string, unknown>, metadata = authorizedMetadata()) => {
    const handlers = createAccountManagerGrpcHandlers({ jwt, privacy, totp, users } as never);
    const handler = handlers[method] as unknown as TestHandler;

    return new Promise<Record<string, unknown>>((resolve, reject) => {
      handler({ metadata, request }, (error, response) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(response ?? {});
      });
    });
  };

  const authorizedMetadata = (): Metadata => {
    const metadata = new Metadata();
    metadata.set('authorization', 'Bearer token');
    return metadata;
  };

  it('rejects missing, duplicate, and malformed authorization metadata before calling a service', async () => {
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }, new Metadata()),
    ).rejects.toMatchObject({
      code: status.UNAUTHENTICATED,
    });

    const duplicateMetadata = authorizedMetadata();
    duplicateMetadata.add('authorization', 'Bearer second-token');
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }, duplicateMetadata),
    ).rejects.toMatchObject({ code: status.UNAUTHENTICATED });

    jwt.extractTokenFromHeader.mockImplementationOnce(() => {
      throw new UnauthorizedException('malformed');
    });
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }),
    ).rejects.toMatchObject({ code: status.UNAUTHENTICATED });
    expect(privacy.findUserSettings).not.toHaveBeenCalled();
  });

  it('rejects non-service, untrusted, and under-privileged callers', async () => {
    jwt.isServiceAccountToken.mockReturnValueOnce(false);
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }),
    ).rejects.toMatchObject({ code: status.PERMISSION_DENIED });

    jwt.isAllowedM2MClient.mockReturnValueOnce(false);
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }),
    ).rejects.toMatchObject({ code: status.PERMISSION_DENIED });

    jwt.hasRequiredRole.mockReturnValueOnce(false);
    await expect(
      invoke('getPrivacySettings', { userId: '018f47b1-5c4e-7c7b-9e6f-0c8c2f7281ad' }),
    ).rejects.toMatchObject({ code: status.PERMISSION_DENIED });
    expect(privacy.findUserSettings).not.toHaveBeenCalled();
  });

  it('validates gRPC-only user, email, and TOTP inputs before calling services', async () => {
    await expect(invoke('getPrivacySettings', { userId: 'not-a-keycloak-id' })).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    await expect(invoke('validateTotp', { primaryEmail: 'invalid', code: '123456' })).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    await expect(
      invoke('validateTotp', { primaryEmail: 'user@example.test', code: '123456<script>' }),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(privacy.findUserSettings).not.toHaveBeenCalled();
    expect(totp.validateCode).not.toHaveBeenCalled();
  });

  it('rejects malformed enrollment arrays instead of silently filtering them', async () => {
    await expect(invoke('lookupUsersByEnrollment', { enrollmentNumbers: ['valid', 42] })).rejects.toMatchObject({
      code: status.INVALID_ARGUMENT,
    });
    expect(users.lookupByEnrollmentNumbers).not.toHaveBeenCalled();
  });

  it('rejects invalid identifier enums and over-limit batches', async () => {
    await expect(
      invoke('lookupUsersByIdentifier', {
        identifiers: [{ requestId: 'one', identifierType: 'passport', identifierValue: 'x' }],
      }),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });

    await expect(
      invoke('lookupUsersByIdentifier', {
        identifiers: Array.from({ length: 201 }, (_, index) => ({
          requestId: String(index),
          identifierType: 'email',
          identifierValue: `${index}@example.test`,
        })),
      }),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });

    await expect(
      invoke('lookupUsersByIdentifier', {
        identifiers: [
          { requestId: 'same', identifierType: 'email', identifierValue: 'first@example.test' },
          { requestId: 'same', identifierType: 'email', identifierValue: 'second@example.test' },
        ],
      }),
    ).rejects.toMatchObject({ code: status.INVALID_ARGUMENT });
    expect(users.lookupByIdentifiers).not.toHaveBeenCalled();
  });

  it('does not expose unexpected internal error messages', async () => {
    users.lookupByEnrollmentNumbers.mockRejectedValueOnce(new Error('postgresql://secret@internal/db'));

    await expect(invoke('lookupUsersByEnrollment', { enrollmentNumbers: ['24123456'] })).rejects.toMatchObject({
      code: status.INTERNAL,
      details: 'Internal gRPC service error.',
    });
  });
});
