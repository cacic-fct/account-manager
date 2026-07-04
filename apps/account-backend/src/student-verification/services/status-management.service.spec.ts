import type { StudentVerificationDocument } from '@prisma/client';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { StatusManagementService } from './status-management.service';
import { BadRequestException } from '@nestjs/common';

type FindFirstArgs = {
  where: {
    userId: string;
    status: 'approved' | 'pending' | 'rejected';
  };
};

type PrismaMock = {
  studentVerificationDocument: {
    findFirst: jest.Mock<Promise<StudentVerificationDocument | null>, [FindFirstArgs]>;
  };
};

type KeycloakMock = {
  getUserAttributes: jest.Mock<
    ReturnType<KeycloakService['getUserAttributes']>,
    Parameters<KeycloakService['getUserAttributes']>
  >;
};

type FeatureFlagMock = {
  isUndergraduateUnespRoleVerificationDisabled: jest.Mock<Promise<boolean>, []>;
};

const createdAt = new Date('2026-06-17T12:00:00.000Z');

const createDocument = (overrides: Partial<StudentVerificationDocument> = {}): StudentVerificationDocument => ({
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
  documents: Partial<Record<'approved' | 'pending' | 'rejected', StudentVerificationDocument>> = {},
) => {
  const findFirst = jest.fn<Promise<StudentVerificationDocument | null>, [FindFirstArgs]>();
  findFirst.mockImplementation((args) => Promise.resolve(documents[args.where.status] ?? null));
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
  const featureFlags: FeatureFlagMock = {
    isUndergraduateUnespRoleVerificationDisabled: jest.fn<Promise<boolean>, []>().mockResolvedValue(false),
  };
  const service = new StatusManagementService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    featureFlags as unknown as FeatureFlagService,
  );

  return {
    service,
    prisma,
    keycloakService,
    featureFlags,
  };
};

describe('StatusManagementService', () => {
  it('returns not_submitted when the user has no verification documents', async () => {
    const { service, keycloakService } = createContext();
    keycloakService.getUserAttributes.mockResolvedValue({});

    await expect(service.getVerificationStatus('user-1')).resolves.toEqual({
      status: 'not_submitted',
    });
  });

  it('returns not_submitted when Keycloak still says the user is verified', async () => {
    const { service, keycloakService } = createContext();
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRoleVerified: ['true'],
    });

    await expect(service.getVerificationStatus('user-1')).resolves.toEqual({
      status: 'not_submitted',
    });
  });

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

  it('omits approved verification date when the database has no value', async () => {
    const approvedDocument = createDocument({
      status: 'approved',
      verificationDate: null,
    });
    const { service } = createContext({
      approved: approvedDocument,
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'approved',
      submissionDate: approvedDocument.createdAt,
      verificationDate: undefined,
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
    keycloakService.getUserAttributes.mockRejectedValue(new Error('Keycloak unavailable'));

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'rejected',
      submissionDate: rejectedDocument.createdAt,
      verificationDate: rejectedDocument.verificationDate ?? undefined,
      rejectionReason: 'Documento ilegivel.',
    });
  });

  it('returns database status when Keycloak throws a non-Error value', async () => {
    const pendingDocument = createDocument({ status: 'pending' });
    const { service, keycloakService } = createContext({
      pending: pendingDocument,
    });
    keycloakService.getUserAttributes.mockRejectedValue('Keycloak unavailable');

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'pending',
      submissionDate: pendingDocument.createdAt,
    });
  });

  it('omits rejected optional fields when the database has no values', async () => {
    const rejectedDocument = createDocument({
      status: 'rejected',
      rejectionReason: null,
      verificationDate: null,
    });
    const { service } = createContext({
      rejected: rejectedDocument,
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'rejected',
      submissionDate: rejectedDocument.createdAt,
      verificationDate: undefined,
      rejectionReason: undefined,
    });
  });

  it('reports undergraduate verification as not required when the global flag is enabled', async () => {
    const { service, prisma, keycloakService, featureFlags } = createContext();
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRole: ['aluno-graduacao'],
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'not_required',
      undergraduateUnespRoleVerificationDisabled: true,
      isDocumentValid: true,
    });
    expect(prisma.studentVerificationDocument.findFirst).not.toHaveBeenCalled();
  });

  it('keeps professor verification behavior unchanged when the global flag is enabled', async () => {
    const pendingDocument = createDocument({ status: 'pending' });
    const { service, keycloakService, featureFlags } = createContext({
      pending: pendingDocument,
    });
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRole: ['professor'],
    });

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'pending',
      submissionDate: pendingDocument.createdAt,
    });
  });

  it('keeps normal verification behavior when the global flag is enabled for users without roles', async () => {
    const pendingDocument = createDocument({ status: 'pending' });
    const { service, keycloakService, featureFlags } = createContext({
      pending: pendingDocument,
    });
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({});

    const result = await service.getVerificationStatus('user-1');

    expect(result).toEqual({
      status: 'pending',
      submissionDate: pendingDocument.createdAt,
    });
  });

  it('keeps normal verification behavior when no feature-flag service is injected', async () => {
    const pendingDocument = createDocument({ status: 'pending' });
    const { prisma, keycloakService } = createContext({
      pending: pendingDocument,
    });
    const service = new StatusManagementService(
      prisma as unknown as PrismaService,
      keycloakService as unknown as KeycloakService,
      undefined,
    );

    await expect(service.getVerificationStatus('user-1')).resolves.toEqual({
      status: 'pending',
      submissionDate: pendingDocument.createdAt,
    });
  });

  it('wraps unexpected database failures when reading verification status', async () => {
    const { service, prisma } = createContext();
    prisma.studentVerificationDocument.findFirst.mockRejectedValue(new Error('database unavailable'));

    await expect(service.getVerificationStatus('user-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('wraps non-Error database failures when reading verification status', async () => {
    const { service, prisma } = createContext();
    prisma.studentVerificationDocument.findFirst.mockRejectedValue('database unavailable');

    await expect(service.getVerificationStatus('user-1')).rejects.toBeInstanceOf(BadRequestException);
  });
});
