import type { StudentVerificationDocument } from '@prisma/client';
import { S3Service } from '../../common/services/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentManagementService } from './document-management.service';
import { NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';

type PrismaMock = {
  studentVerificationDocument: {
    findUnique: jest.Mock<Promise<StudentVerificationDocument | null>, [unknown]>;
    findMany: jest.Mock<Promise<StudentVerificationDocument[]>, [unknown]>;
    update: jest.Mock<Promise<unknown>, [unknown]>;
  };
  $transaction: jest.Mock;
};

type S3Mock = {
  downloadFile: jest.Mock<ReturnType<S3Service['downloadFile']>, [unknown]>;
  deleteFile: jest.Mock<ReturnType<S3Service['deleteFile']>, [unknown]>;
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
  const findUnique = jest.fn<Promise<StudentVerificationDocument | null>, [unknown]>();
  const findMany = jest.fn<Promise<StudentVerificationDocument[]>, [unknown]>().mockResolvedValue([]);
  const update = jest.fn<Promise<unknown>, [unknown]>();
  update.mockResolvedValue({});
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const createLog = jest.fn<
    Promise<unknown>,
    [{ data: { documentId: string; userId: string; action: string; performedBy: string; reason: string } }]
  >();
  createLog.mockResolvedValue({});
  const tx = {
    studentVerificationDocument: { updateMany },
    studentVerificationLog: { create: createLog },
  };
  const transaction = jest.fn(async (callback: (transactionClient: typeof tx) => Promise<unknown>) => callback(tx));
  const downloadFile = jest.fn<ReturnType<S3Service['downloadFile']>, [unknown]>();
  const deleteFile = jest.fn<ReturnType<S3Service['deleteFile']>, [unknown]>();
  downloadFile.mockResolvedValue({
    stream: Readable.from('file'),
    contentType: 'application/pdf',
  });
  deleteFile.mockResolvedValue(undefined);

  const prisma: PrismaMock = {
    studentVerificationDocument: {
      findUnique,
      findMany,
      update,
    },
    $transaction: transaction,
  };

  const s3Service: S3Mock = {
    downloadFile,
    deleteFile,
  };

  const configService = { get: jest.fn().mockReturnValue(undefined) };
  const service = new DocumentManagementService(
    prisma as unknown as PrismaService,
    s3Service as unknown as S3Service,
    configService as unknown as ConfigService,
  );

  return {
    service,
    prisma,
    s3Service,
    tx,
  };
};

describe('DocumentManagementService', () => {
  it('downloads a stored document file', async () => {
    const { service, prisma, s3Service } = createContext();
    const document = createDocument();
    prisma.studentVerificationDocument.findUnique.mockResolvedValue(document);

    const result = await service.getDocumentFile('document-1');

    expect(result.stream).toBeInstanceOf(Readable);
    expect(result).toMatchObject({
      mimeType: 'application/pdf',
      originalFileName: 'proof.pdf',
    });
    expect(s3Service.downloadFile).toHaveBeenCalledWith('student-verification/user-1/generated-proof.pdf');
  });

  it('rejects document file downloads when metadata or storage is missing', async () => {
    const { service, prisma, s3Service } = createContext();
    prisma.studentVerificationDocument.findUnique.mockResolvedValueOnce(null);

    await expect(service.getDocumentFile('missing')).rejects.toBeInstanceOf(NotFoundException);

    prisma.studentVerificationDocument.findUnique.mockResolvedValueOnce(createDocument({ s3Key: null }));
    await expect(service.getDocumentFile('document-1')).rejects.toBeInstanceOf(NotFoundException);

    prisma.studentVerificationDocument.findUnique.mockResolvedValueOnce(createDocument());
    s3Service.downloadFile.mockRejectedValueOnce(new Error('storage down'));
    await expect(service.getDocumentFile('document-1')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('removes approved document storage and sensitive fields', async () => {
    const { service, prisma, s3Service } = createContext();
    const document = createDocument();

    await service.cleanupApprovedDocument(document);

    expect(s3Service.deleteFile).toHaveBeenCalledWith('student-verification/user-1/generated-proof.pdf');
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

  it('logs cleanup failures without throwing', async () => {
    const { service, prisma } = createContext();
    prisma.studentVerificationDocument.update.mockRejectedValue(new Error('database unavailable'));

    await expect(service.cleanupApprovedDocument(createDocument())).resolves.toBeUndefined();
  });

  it('logs non-Error cleanup failures without throwing', async () => {
    const { service, prisma } = createContext();
    prisma.studentVerificationDocument.update.mockRejectedValue('database unavailable');

    await expect(service.cleanupApprovedDocument(createDocument())).resolves.toBeUndefined();
  });

  it('purges expired pending and rejected files while preserving audit records', async () => {
    const { service, prisma, s3Service, tx } = createContext();
    const pending = createDocument({ id: 'pending-1', status: 'pending', s3Key: 'pending-key' });
    const rejected = createDocument({ id: 'rejected-1', status: 'rejected', s3Key: 'rejected-key' });
    prisma.studentVerificationDocument.findMany.mockResolvedValue([pending, rejected]);

    await service.cleanupExpiredDocuments();

    expect(s3Service.deleteFile).toHaveBeenCalledWith('pending-key');
    expect(s3Service.deleteFile).toHaveBeenCalledWith('rejected-key');
    expect(tx.studentVerificationDocument.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.studentVerificationLog.create).toHaveBeenCalledTimes(1);
    const logCall = tx.studentVerificationLog.create.mock.calls[0][0];
    expect(logCall.data).toMatchObject({
      documentId: 'pending-1',
      userId: 'user-1',
      action: 'rejected',
      performedBy: 'retention-policy',
    });
  });

  it('does not clear database references when retention storage deletion fails', async () => {
    const { service, prisma, s3Service, tx } = createContext();
    prisma.studentVerificationDocument.findMany.mockResolvedValue([
      createDocument({ id: 'pending-1', status: 'pending', s3Key: 'pending-key' }),
    ]);
    s3Service.deleteFile.mockRejectedValue(new Error('storage unavailable'));

    await expect(service.cleanupExpiredDocuments()).resolves.toBeUndefined();
    expect(tx.studentVerificationDocument.updateMany).not.toHaveBeenCalled();
  });
});
