import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { StudentVerificationDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakService } from '../services/keycloak.service';
import { FeatureFlagService } from '../../feature-flags/feature-flags.service';
import { UniversityValidationGuard } from './university-validation.guard';

type PrismaMock = {
  studentVerificationDocument: {
    findFirst: jest.Mock<Promise<StudentVerificationDocument | null>, [unknown]>;
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
  status: 'approved',
  rejectionReason: null,
  verifiedBy: 'admin@example.com',
  verificationDate: new Date('2026-06-17T12:05:00.000Z'),
  authenticationCode: null,
  extractedName: null,
  documentEmissionDate: null,
  documentExpirationDate: null,
  isDocumentValid: null,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createExecutionContext = (keycloakId: string | null = 'user-1'): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        session: keycloakId
          ? {
              user: {
                keycloakId,
              },
            }
          : {},
      }),
    }),
  }) as ExecutionContext;

const createContext = () => {
  const findFirst = jest.fn<Promise<StudentVerificationDocument | null>, [unknown]>();
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
  const guard = new UniversityValidationGuard(
    keycloakService as unknown as KeycloakService,
    prisma as unknown as PrismaService,
    featureFlags as unknown as FeatureFlagService,
  );

  return {
    guard,
    prisma,
    keycloakService,
    featureFlags,
  };
};

describe('UniversityValidationGuard', () => {
  it('requires an authenticated session', async () => {
    const { guard, prisma, keycloakService } = createContext();

    await expect(guard.canActivate(createExecutionContext(null))).rejects.toMatchObject({
      response: {
        message: 'Authentication required',
      },
    });

    expect(prisma.studentVerificationDocument.findFirst).not.toHaveBeenCalled();
    expect(keycloakService.getUserAttributes).not.toHaveBeenCalled();
  });

  it('blocks validation endpoints when the database has an approved document', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(createDocument());

    await expect(guard.canActivate(createExecutionContext())).rejects.toBeInstanceOf(ForbiddenException);

    expect(keycloakService.getUserAttributes).not.toHaveBeenCalled();
  });

  it('allows validation when only Keycloak says approved but the database does not', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRoleVerified: ['true'],
    });

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
  });

  it('blocks undergraduate validation when the global flag is enabled', async () => {
    const { guard, prisma, keycloakService, featureFlags } = createContext();
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRole: ['aluno-graduacao'],
    });

    await expect(guard.canActivate(createExecutionContext())).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.studentVerificationDocument.findFirst).not.toHaveBeenCalled();
  });

  it('keeps professor validation behavior unchanged when the global flag is enabled', async () => {
    const { guard, prisma, keycloakService, featureFlags } = createContext();
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRole: ['professor'],
    });
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
  });

  it('allows validation when Keycloak drift comparison fails after the database check', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);
    keycloakService.getUserAttributes.mockRejectedValue(new Error('Keycloak unavailable'));

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
  });

  it('allows validation when Keycloak drift comparison throws a non-Error value', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);
    keycloakService.getUserAttributes.mockRejectedValue('Keycloak unavailable');

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
  });

  it('keeps validation enabled when undergraduate flag is enabled for users without roles', async () => {
    const { guard, prisma, keycloakService, featureFlags } = createContext();
    featureFlags.isUndergraduateUnespRoleVerificationDisabled.mockResolvedValue(true);
    keycloakService.getUserAttributes.mockResolvedValue({});
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(true);
  });

  it('wraps unexpected database failures as forbidden access', async () => {
    const { guard, prisma } = createContext();
    prisma.studentVerificationDocument.findFirst.mockRejectedValue(new Error('database unavailable'));

    await expect(guard.canActivate(createExecutionContext())).rejects.toMatchObject({
      response: {
        message: 'Unable to verify university validation status',
      },
    });
  });
});
