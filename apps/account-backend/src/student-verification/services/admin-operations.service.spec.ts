import { BadRequestException } from '@nestjs/common';
import type { StudentVerificationDocument } from '@prisma/client';
import { KeycloakService } from '../../auth/services/keycloak.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AdminOperationsService } from './admin-operations.service';
import { DocumentManagementService } from './document-management.service';

type PrismaMock = {
  $transaction: jest.Mock<
    Promise<StudentVerificationDocument>,
    [(tx: TransactionMock) => Promise<StudentVerificationDocument>, unknown]
  >;
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    findUnique: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    update: jest.Mock<Promise<StudentVerificationDocument>, [unknown]>;
  };
  studentVerificationLog: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

type TransactionMock = {
  $queryRaw: jest.Mock<Promise<unknown>, unknown[]>;
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    findUnique: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    update: jest.Mock<Promise<StudentVerificationDocument>, [unknown]>;
  };
  studentVerificationLog: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

type DocumentUpdateArgs = {
  where: {
    id: string;
  };
  data: {
    status: 'approved' | 'rejected';
    verifiedBy: string;
    verificationDate: Date;
    rejectionReason: string | null;
  };
};

type VerificationLogCreateArgs = {
  data: {
    documentId: string;
    userId: string;
    action: 'approved' | 'rejected';
    performedBy: string;
    reason: string | null;
    metadata: {
      previousStatus: string;
      verificationDate: string | null;
    };
  };
};

type KeycloakMock = {
  updateUserAttributes: jest.Mock<
    ReturnType<KeycloakService['updateUserAttributes']>,
    Parameters<KeycloakService['updateUserAttributes']>
  >;
};

type DocumentManagementMock = {
  cleanupApprovedDocument: jest.Mock<
    ReturnType<DocumentManagementService['cleanupApprovedDocument']>,
    Parameters<DocumentManagementService['cleanupApprovedDocument']>
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
  const findFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  findFirst.mockResolvedValue(null);
  const findUnique = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  const update = jest.fn<Promise<StudentVerificationDocument>, [unknown]>();
  const createLog = jest.fn<Promise<unknown>, [unknown]>();
  createLog.mockResolvedValue({});
  const transactionQueryRaw = jest.fn<Promise<unknown>, unknown[]>();
  transactionQueryRaw.mockResolvedValue({});
  const transactionFindUnique = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  const transactionFindFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  transactionFindFirst.mockResolvedValue(null);
  const transactionUpdate = jest.fn<
    Promise<StudentVerificationDocument>,
    [unknown]
  >();
  const transactionCreateLog = jest.fn<Promise<unknown>, [unknown]>();
  transactionCreateLog.mockResolvedValue({});
  const tx: TransactionMock = {
    $queryRaw: transactionQueryRaw,
    studentVerificationDocument: {
      findFirst: transactionFindFirst,
      findUnique: transactionFindUnique,
      update: transactionUpdate,
    },
    studentVerificationLog: {
      create: transactionCreateLog,
    },
  };
  const transaction = jest.fn<
    Promise<StudentVerificationDocument>,
    [(tx: TransactionMock) => Promise<StudentVerificationDocument>, unknown]
  >();
  transaction.mockImplementation(async (callback) => callback(tx));
  const updateUserAttributes = jest.fn<
    ReturnType<KeycloakService['updateUserAttributes']>,
    Parameters<KeycloakService['updateUserAttributes']>
  >();
  updateUserAttributes.mockResolvedValue(undefined);
  const cleanupApprovedDocument = jest.fn<
    ReturnType<DocumentManagementService['cleanupApprovedDocument']>,
    Parameters<DocumentManagementService['cleanupApprovedDocument']>
  >();
  cleanupApprovedDocument.mockResolvedValue(undefined);

  const prisma: PrismaMock = {
    $transaction: transaction,
    studentVerificationDocument: {
      findFirst,
      findUnique,
      update,
    },
    studentVerificationLog: {
      create: createLog,
    },
  };

  const keycloakService: KeycloakMock = {
    updateUserAttributes,
  };

  const documentManagementService: DocumentManagementMock = {
    cleanupApprovedDocument,
  };

  const service = new AdminOperationsService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    documentManagementService as unknown as DocumentManagementService,
  );

  return {
    service,
    prisma,
    tx,
    keycloakService,
    documentManagementService,
  };
};

describe('AdminOperationsService', () => {
  it('approves a pending document through Keycloak, database, audit log, and cleanup', async () => {
    const { service, tx, keycloakService, documentManagementService } =
      createContext();
    const pendingDocument = createDocument();
    const approvedDocument = createDocument({
      status: 'approved',
      verifiedBy: 'admin@example.com',
      verificationDate: new Date('2026-06-17T12:05:00.000Z'),
      rejectionReason: null,
    });

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      pendingDocument,
    );
    tx.studentVerificationDocument.update.mockResolvedValue(approvedDocument);

    const result = await service.updateVerificationStatus(
      'document-1',
      { status: 'approved' },
      'admin@example.com',
    );

    expect(result).toBe(approvedDocument);
    expect(keycloakService.updateUserAttributes).toHaveBeenCalledWith(
      'user-1',
      {
        unespRoleVerified: 'true',
      },
    );
    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.studentVerificationDocument.findUnique).toHaveBeenCalledWith({
      where: { id: 'document-1' },
    });
    const updateArgs = tx.studentVerificationDocument.update.mock
      .calls[0][0] as DocumentUpdateArgs;
    expect(updateArgs.where).toEqual({ id: 'document-1' });
    expect(updateArgs.data.status).toBe('approved');
    expect(updateArgs.data.verifiedBy).toBe('admin@example.com');
    expect(updateArgs.data.verificationDate).toBeInstanceOf(Date);
    expect(updateArgs.data.rejectionReason).toBeNull();
    const logArgs = tx.studentVerificationLog.create.mock
      .calls[0][0] as VerificationLogCreateArgs;
    expect(logArgs.data.documentId).toBe('document-1');
    expect(logArgs.data.userId).toBe('user-1');
    expect(logArgs.data.action).toBe('approved');
    expect(logArgs.data.performedBy).toBe('admin@example.com');
    expect(logArgs.data.reason).toBeNull();
    expect(logArgs.data.metadata.previousStatus).toBe('pending');
    expect(logArgs.data.metadata.verificationDate).toBe(
      approvedDocument.verificationDate?.toISOString() ?? null,
    );
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).toHaveBeenCalledWith(approvedDocument);
    expect(
      keycloakService.updateUserAttributes.mock.invocationCallOrder[0],
    ).toBeLessThan(
      tx.studentVerificationDocument.update.mock.invocationCallOrder[0],
    );
  });

  it('does not update the document when Keycloak approval fails', async () => {
    const { service, tx, keycloakService, documentManagementService } =
      createContext();

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      createDocument(),
    );
    keycloakService.updateUserAttributes.mockRejectedValue(
      new Error('Keycloak unavailable'),
    );

    await expect(
      service.updateVerificationStatus(
        'document-1',
        { status: 'approved' },
        'admin@example.com',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(tx.studentVerificationDocument.update).not.toHaveBeenCalled();
    expect(tx.studentVerificationLog.create).not.toHaveBeenCalled();
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).not.toHaveBeenCalled();
  });

  it('rolls back Keycloak approval under the user transition lock when database persistence fails after Keycloak succeeds', async () => {
    const { service, tx, keycloakService, documentManagementService } =
      createContext();
    const persistenceError = new Error('database unavailable');

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      createDocument(),
    );
    keycloakService.updateUserAttributes
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);
    tx.studentVerificationDocument.update.mockRejectedValue(persistenceError);

    await expect(
      service.updateVerificationStatus(
        'document-1',
        { status: 'approved' },
        'admin@example.com',
      ),
    ).rejects.toThrow(persistenceError);

    expect(keycloakService.updateUserAttributes).toHaveBeenNthCalledWith(
      1,
      'user-1',
      {
        unespRoleVerified: 'true',
      },
    );
    expect(tx.studentVerificationDocument.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: 'approved',
      },
    });
    expect(keycloakService.updateUserAttributes).toHaveBeenNthCalledWith(
      2,
      'user-1',
      {
        unespRoleVerified: 'false',
      },
    );
    expect(tx.studentVerificationDocument.update).toHaveBeenCalled();
    expect(tx.studentVerificationLog.create).not.toHaveBeenCalled();
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).not.toHaveBeenCalled();
  });

  it('does not roll back Keycloak after a transaction failure when another approved document is visible under the user lock', async () => {
    const { service, prisma, tx, keycloakService, documentManagementService } =
      createContext();
    const commitError = new Error('commit failed');
    const approvedDocument = createDocument({
      status: 'approved',
      verificationDate: new Date('2026-06-17T12:05:00.000Z'),
    });

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      createDocument(),
    );
    tx.studentVerificationDocument.update.mockResolvedValue(approvedDocument);
    tx.studentVerificationDocument.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(approvedDocument);
    prisma.$transaction
      .mockImplementationOnce(async (callback) => {
        await callback(tx);
        throw commitError;
      })
      .mockImplementationOnce(async (callback) => callback(tx));

    await expect(
      service.updateVerificationStatus(
        'document-1',
        { status: 'approved' },
        'admin@example.com',
      ),
    ).rejects.toThrow(commitError);

    expect(keycloakService.updateUserAttributes).toHaveBeenCalledTimes(1);
    expect(keycloakService.updateUserAttributes).toHaveBeenCalledWith(
      'user-1',
      {
        unespRoleVerified: 'true',
      },
    );
    expect(tx.studentVerificationDocument.findFirst).toHaveBeenNthCalledWith(
      2,
      {
        where: {
          userId: 'user-1',
          status: 'approved',
        },
      },
    );
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).not.toHaveBeenCalled();
  });

  it('rejects a pending document with a reason without touching Keycloak or cleanup', async () => {
    const { service, tx, keycloakService, documentManagementService } =
      createContext();
    const rejectedDocument = createDocument({
      status: 'rejected',
      rejectionReason: 'Enrollment proof does not match the account.',
      verifiedBy: 'admin@example.com',
      verificationDate: new Date('2026-06-17T12:05:00.000Z'),
    });

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      createDocument(),
    );
    tx.studentVerificationDocument.update.mockResolvedValue(rejectedDocument);

    const result = await service.updateVerificationStatus(
      'document-1',
      {
        status: 'rejected',
        rejectionReason: 'Enrollment proof does not match the account.',
      },
      'admin@example.com',
    );

    expect(result).toBe(rejectedDocument);
    expect(keycloakService.updateUserAttributes).not.toHaveBeenCalled();
    const updateArgs = tx.studentVerificationDocument.update.mock
      .calls[0][0] as DocumentUpdateArgs;
    expect(updateArgs.where).toEqual({ id: 'document-1' });
    expect(updateArgs.data.status).toBe('rejected');
    expect(updateArgs.data.verifiedBy).toBe('admin@example.com');
    expect(updateArgs.data.verificationDate).toBeInstanceOf(Date);
    expect(updateArgs.data.rejectionReason).toBe(
      'Enrollment proof does not match the account.',
    );
    const logArgs = tx.studentVerificationLog.create.mock
      .calls[0][0] as VerificationLogCreateArgs;
    expect(logArgs.data.documentId).toBe('document-1');
    expect(logArgs.data.userId).toBe('user-1');
    expect(logArgs.data.action).toBe('rejected');
    expect(logArgs.data.performedBy).toBe('admin@example.com');
    expect(logArgs.data.reason).toBe(
      'Enrollment proof does not match the account.',
    );
    expect(logArgs.data.metadata.previousStatus).toBe('pending');
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).not.toHaveBeenCalled();
  });

  it('blocks verification of documents that are no longer pending', async () => {
    const { service, tx, keycloakService, documentManagementService } =
      createContext();

    tx.studentVerificationDocument.findUnique.mockResolvedValue(
      createDocument({ status: 'approved' }),
    );

    await expect(
      service.updateVerificationStatus(
        'document-1',
        { status: 'rejected', rejectionReason: 'Late review.' },
        'admin@example.com',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(keycloakService.updateUserAttributes).not.toHaveBeenCalled();
    expect(tx.studentVerificationDocument.update).not.toHaveBeenCalled();
    expect(tx.studentVerificationLog.create).not.toHaveBeenCalled();
    expect(
      documentManagementService.cleanupApprovedDocument,
    ).not.toHaveBeenCalled();
  });

  it('requires a rejection reason before opening the transition transaction', async () => {
    const { service, prisma, tx } = createContext();

    await expect(
      service.updateVerificationStatus(
        'document-1',
        { status: 'rejected', rejectionReason: '   ' },
        'admin@example.com',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(tx.studentVerificationDocument.findUnique).not.toHaveBeenCalled();
  });
});
