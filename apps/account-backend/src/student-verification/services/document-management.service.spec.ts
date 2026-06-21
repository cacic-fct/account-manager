import type { StudentVerificationDocument } from '@prisma/client';
import { S3Service } from '../../common/services/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentManagementService } from './document-management.service';

type PrismaMock = {
  studentVerificationDocument: {
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

type S3Mock = {
  deleteFile: jest.Mock<ReturnType<S3Service['deleteFile']>, [unknown]>;
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
  authenticationCode: 'AUTH-CODE',
  extractedName: null,
  documentEmissionDate: null,
  documentExpirationDate: null,
  isDocumentValid: true,
  createdAt,
  updatedAt: createdAt,
  ...overrides,
});

const createContext = () => {
  const update = jest.fn<Promise<unknown>, [unknown]>();
  update.mockResolvedValue({});
  const deleteFile = jest.fn<ReturnType<S3Service['deleteFile']>, [unknown]>();
  deleteFile.mockResolvedValue(undefined);

  const prisma: PrismaMock = {
    studentVerificationDocument: {
      update,
    },
  };

  const s3Service: S3Mock = {
    deleteFile,
  };

  const service = new DocumentManagementService(
    prisma as unknown as PrismaService,
    s3Service as unknown as S3Service,
  );

  return {
    service,
    prisma,
    s3Service,
  };
};

describe('DocumentManagementService', () => {
  it('removes approved document storage and sensitive fields', async () => {
    const { service, prisma, s3Service } = createContext();
    const document = createDocument();

    await service.cleanupApprovedDocument(document);

    expect(s3Service.deleteFile).toHaveBeenCalledWith(
      'student-verification/user-1/generated-proof.pdf',
    );
    expect(prisma.studentVerificationDocument.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: {
        authenticationCode: null,
        s3Key: null,
        filePath: '',
      },
    });
  });

  it('clears sensitive fields even when an approved document has no S3 key', async () => {
    const { service, prisma, s3Service } = createContext();
    const document = createDocument({
      s3Key: null,
      filePath: '',
    });

    await service.cleanupApprovedDocument(document);

    expect(s3Service.deleteFile).not.toHaveBeenCalled();
    expect(prisma.studentVerificationDocument.update).toHaveBeenCalledWith({
      where: { id: 'document-1' },
      data: {
        authenticationCode: null,
        s3Key: null,
        filePath: '',
      },
    });
  });
});
