import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import type { StudentVerificationDocument } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { KeycloakService } from '../services/keycloak.service';
import { UniversityValidationGuard } from './university-validation.guard';

type PrismaMock = {
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
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

const createExecutionContext = (): ExecutionContext =>
  ({
    switchToHttp: () => ({
      getRequest: () => ({
        session: {
          user: {
            keycloakId: 'user-1',
          },
        },
      }),
    }),
  }) as ExecutionContext;

const createContext = () => {
  const findFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
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
  const guard = new UniversityValidationGuard(
    keycloakService as unknown as KeycloakService,
    prisma as unknown as PrismaService,
  );

  return {
    guard,
    prisma,
    keycloakService,
  };
};

describe('UniversityValidationGuard', () => {
  it('blocks validation endpoints when the database has an approved document', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(
      createDocument(),
    );

    await expect(
      guard.canActivate(createExecutionContext()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(keycloakService.getUserAttributes).not.toHaveBeenCalled();
  });

  it('allows validation when only Keycloak says approved but the database does not', async () => {
    const { guard, prisma, keycloakService } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(null);
    keycloakService.getUserAttributes.mockResolvedValue({
      unespRoleVerified: ['true'],
    });

    await expect(guard.canActivate(createExecutionContext())).resolves.toBe(
      true,
    );
  });
});
