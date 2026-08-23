import { Metadata, status, type ServiceError } from '@grpc/grpc-js';
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

  const invoke = (method: string, request: Record<string, unknown>) => {
    const metadata = new Metadata();
    metadata.set('authorization', 'Bearer token');
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
