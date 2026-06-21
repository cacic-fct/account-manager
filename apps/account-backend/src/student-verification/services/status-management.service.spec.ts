import type { StudentVerificationDocument } from '@prisma/client';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';
import { StatusManagementService } from './status-management.service';

type FindFirstArgs = {
  where: {
    userId: string;
    status: 'approved' | 'pending' | 'rejected';
  };
};

type PrismaMock = {
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [FindFirstArgs]
    >;
  };
};

type KeycloakMock = {
  getUserAttributes: jest.Mock<
    ReturnType<KeycloakService['getUserAttributes']>,
    Parameters<KeycloakService['getUserAttributes']>
  >;
};

const createdAt = new Date('2026-06-17T12:00:00.000Z');

const createDocument = (
  overrides: Partial<StudentVerificationDocument> = {},
): StudentVerificationDocument => ({
  id: 'document-1',
  userId: 'user-1',
  originalFileName: 'proof.pdf',
  storedFileName: 'generated-proof.pdf',
  filePath: 'student-verification/user-1/generated-proof.pdf',
  s3Key: 'student-verification/user-1/generated-proof.pdf',
  mimeType: 'application/pdf',
  fileSize: 128,
  status: 'pending',
  rejectionReason: null,
  verifiedBy: null,
  verificationDate: null,
  authenticationCode: null,
  extractedName: null,
  documentEmissionDate: null,
  documentExpirationDate: null,
  isDocumentValid: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createContext = (
  documents: Partial<
    Record<'approved' | 'pending' | 'rejected', StudentVerificationDocument>
  > = {},
) => {
  const findFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [FindFirstArgs]
  >();
  findFirst.mockImplementation((args) =>
    Promise.resolve(documents[args.where.status] ?? null),
  );
  const getUserAttributes = jest.fn<
    ReturnType<KeycloakService['getUserAttributes']>,
    Parameters<KeycloakService['getUserAttributes']>
  >();
  getUserAttributes.mockResolvedValue({});

  const prisma: PrismaMock = {
    studentVerificationDocument: {
      findFirst,
    },
  };
  const keycloakService: KeycloakMock = {
    getUserAttributes,
  };
  const service = new StatusManagementService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
  );

  return {
    service,
    prisma,
    keycloakService,
  };
};

describe('StatusManagementService', () => {
  it('returns approved from the database even when Keycloak is stale', async () => {
    const approvedDocument = createDocument({
      status: 'approved',
      verificationDate: new Date('2026-06-17T12:05:00.000Z'),
    });
    const { service, keycloakService } = createContext({
      approved: approvedDocument,
    });
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRoleVerified: ['false'],
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'approved',
      submissionDate: approvedDocument.createdAt,
      verificationDate: approvedDocument.verificationDate ?? undefined,
    });
  });

  it('does not report approved from Keycloak when no approved database document exists', async () => {
    const pendingDocument = createDocument({ status: 'pending' });
    const { service, keycloakService } = createContext({
      pending: pendingDocument,
    });
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRoleVerified: ['true'],
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'pending',
      submissionDate: pendingDocument.createdAt,
    });
  });

  it('returns database status even when Keycloak cannot be reached', async () => {
    const rejectedDocument = createDocument({
      status: 'rejected',
      rejectionReason: 'Documento ilegivel.',
      verificationDate: new Date('2026-06-17T12:05:00.000Z'),
    });
    const { service, keycloakService } = createContext({
      rejected: rejectedDocument,
    });
    keycloakService.getUserAttributes.mockRejectedValue(
      new Error('Keycloak unavailable'),
    );

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'rejected',
      submissionDate: rejectedDocument.createdAt,
      verificationDate: rejectedDocument.verificationDate ?? undefined,
      rejectionReason: 'Documento ilegivel.',
    });
  });
});
