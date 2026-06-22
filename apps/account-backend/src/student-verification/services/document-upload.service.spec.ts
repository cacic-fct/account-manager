import { BadRequestException } from '@nestjs/common';
import type { Prisma, StudentVerificationDocument } from '@prisma/client';
import type {} from 'multer';
import { Readable } from 'stream';
import { S3Service } from '../../common/services/s3.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PdfProcessingService } from '../../university-validation/services/pdf-processing.service';
import { DocumentUploadService } from './document-upload.service';
import { PdfVerificationService } from './pdf-verification.service';

jest.mock(
  '../../university-validation/services/pdf-processing.service',
  () => ({
    PdfProcessingService: class PdfProcessingService {},
  }),
);

jest.mock('uuid', () => ({
  v7: jest.fn(() => '00000000-0000-7000-8000-000000000001'),
}));

type DocumentCreateArgs = {
  data: Prisma.StudentVerificationDocumentCreateInput;
};

type VerificationLogCreateArgs = {
  data: {
    documentId: string;
    userId: string;
    action:
      | 'upload'
      | 'approved'
      | 'rejected'
      | 'automated_approved'
      | 'automated_rejected';
    performedBy: string;
    reason?: string | null;
    metadata?: Prisma.InputJsonValue;
  };
};

type UploadMetadata = {
  userId: string;
  originalFileName: string;
  uploadedAt: string;
};

type LogMetadata = {
  fileName: string;
  fileSize: number;
  mimeType: string;
  authenticationCode: string | null;
  isManualFallback: boolean;
};

type PrismaMock = {
  $transaction: jest.Mock<
    Promise<StudentVerificationDocument>,
    [(tx: TransactionMock) => Promise<StudentVerificationDocument>]
  >;
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    create: jest.Mock<Promise<StudentVerificationDocument>, [unknown]>;
  };
  studentVerificationLog: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

type S3Mock = {
  generateFileKey: jest.Mock<string, unknown[]>;
  uploadFile: jest.Mock<ReturnType<S3Service['uploadFile']>, unknown[]>;
  deleteFile: jest.Mock<ReturnType<S3Service['deleteFile']>, [unknown]>;
};

type PdfProcessingMock = {
  extractAuthCodeFromPdf: jest.Mock<
    Promise<string>,
    Parameters<PdfProcessingService['extractAuthCodeFromPdf']>
  >;
};

type PdfVerificationMock = {
  verifyPdfDocumentFromBuffer: jest.Mock<
    ReturnType<PdfVerificationService['verifyPdfDocumentFromBuffer']>,
    Parameters<PdfVerificationService['verifyPdfDocumentFromBuffer']>
  >;
};

type TransactionMock = {
  $queryRaw: jest.Mock<Promise<unknown>, unknown[]>;
  studentVerificationDocument: {
    findFirst: jest.Mock<
      Promise<StudentVerificationDocument | null>,
      [unknown]
    >;
    create: jest.Mock<Promise<StudentVerificationDocument>, [unknown]>;
  };
  studentVerificationLog: {
    create: jest.Mock<Promise<unknown>, [unknown]>;
  };
};

const createdAt = new Date('2026-06-17T12:00:00.000Z');
const s3Key = 'student-verification/user-1/generated-proof.pdf';

const createDocument = (
  overrides: Partial<StudentVerificationDocument> = {},
): StudentVerificationDocument => ({
  id: 'document-1',
  userId: 'user-1',
  originalFileName: 'proof.pdf',
  storedFileName: 'generated-proof.pdf',
  filePath: s3Key,
  s3Key,
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

const createFile = (
  overrides: Partial<Express.Multer.File> = {},
): Express.Multer.File => {
  const buffer = Buffer.from('%PDF-1.4 proof');

  return {
    fieldname: 'document',
    originalname: 'proof.pdf',
    encoding: '7bit',
    mimetype: 'application/pdf',
    size: buffer.length,
    buffer,
    stream: Readable.from(buffer),
    destination: '',
    filename: '',
    path: '',
    ...overrides,
  };
};

const createContext = () => {
  const findFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  findFirst.mockResolvedValue(null);
  const create = jest.fn<Promise<StudentVerificationDocument>, [unknown]>();
  const createLog = jest.fn<Promise<unknown>, [unknown]>();
  createLog.mockResolvedValue({});
  const transactionQueryRaw = jest.fn<Promise<unknown>, unknown[]>();
  transactionQueryRaw.mockResolvedValue({});
  const transactionFindFirst = jest.fn<
    Promise<StudentVerificationDocument | null>,
    [unknown]
  >();
  transactionFindFirst.mockResolvedValue(null);
  const transactionCreate = jest.fn<
    Promise<StudentVerificationDocument>,
    [unknown]
  >();
  const transactionCreateLog = jest.fn<Promise<unknown>, [unknown]>();
  transactionCreateLog.mockResolvedValue({});
  const tx: TransactionMock = {
    $queryRaw: transactionQueryRaw,
    studentVerificationDocument: {
      findFirst: transactionFindFirst,
      create: transactionCreate,
    },
    studentVerificationLog: {
      create: transactionCreateLog,
    },
  };
  const transaction = jest.fn<
    Promise<StudentVerificationDocument>,
    [(tx: TransactionMock) => Promise<StudentVerificationDocument>]
  >();
  transaction.mockImplementation(async (callback) => callback(tx));
  const generateFileKey = jest.fn<string, unknown[]>();
  generateFileKey.mockReturnValue(s3Key);
  const uploadFile = jest.fn<ReturnType<S3Service['uploadFile']>, unknown[]>();
  const deleteFile = jest.fn<ReturnType<S3Service['deleteFile']>, [unknown]>();
  deleteFile.mockResolvedValue(undefined);
  const extractAuthCodeFromPdf = jest.fn<
    Promise<string>,
    Parameters<PdfProcessingService['extractAuthCodeFromPdf']>
  >();
  const verifyPdfDocumentFromBuffer = jest.fn<
    ReturnType<PdfVerificationService['verifyPdfDocumentFromBuffer']>,
    Parameters<PdfVerificationService['verifyPdfDocumentFromBuffer']>
  >();

  const prisma: PrismaMock = {
    $transaction: transaction,
    studentVerificationDocument: {
      findFirst,
      create,
    },
    studentVerificationLog: {
      create: createLog,
    },
  };

  const s3Service: S3Mock = {
    generateFileKey,
    uploadFile,
    deleteFile,
  };

  const pdfProcessingService: PdfProcessingMock = {
    extractAuthCodeFromPdf,
  };

  const pdfVerificationService: PdfVerificationMock = {
    verifyPdfDocumentFromBuffer,
  };

  const service = new DocumentUploadService(
    prisma as unknown as PrismaService,
    s3Service as unknown as S3Service,
    pdfProcessingService as unknown as PdfProcessingService,
    pdfVerificationService as unknown as PdfVerificationService,
  );

  return {
    service,
    prisma,
    s3Service,
    tx,
    pdfProcessingService,
    pdfVerificationService,
  };
};

describe('DocumentUploadService', () => {
  it('keeps the original filename when filename decoding fails', () => {
    const { service } = createContext();
    const bufferFromSpy = jest.spyOn(Buffer, 'from');
    bufferFromSpy.mockImplementationOnce(() => {
      throw new Error('decode failed');
    });
    const internals = service as unknown as {
      fixFilenameEncoding: (originalFilename: string) => string;
    };

    expect(internals.fixFilenameEncoding('comprovanteÃ©.pdf')).toBe(
      'comprovanteÃ©.pdf',
    );

    bufferFromSpy.mockRestore();
  });

  it('keeps the original filename when filename decoding throws a non-Error value', () => {
    class DecodeFailure {}

    const { service } = createContext();
    const bufferFromSpy = jest.spyOn(Buffer, 'from');
    bufferFromSpy.mockImplementationOnce(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error
      throw new DecodeFailure();
    });
    const internals = service as unknown as {
      fixFilenameEncoding: (originalFilename: string) => string;
    };

    expect(internals.fixFilenameEncoding('comprovanteÃ©.pdf')).toBe(
      'comprovanteÃ©.pdf',
    );

    bufferFromSpy.mockRestore();
  });

  it('rejects unsupported file types and oversized uploads before storage', async () => {
    const { service, s3Service } = createContext();

    await expect(
      service.uploadDocument(createFile({ mimetype: 'image/png' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadDocument(createFile({ mimetype: 'text/plain' }), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.uploadDocument(
        createFile({ size: 10 * 1024 * 1024 + 1 }),
        'user-1',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });

  it('rejects uploads while a pending document already exists', async () => {
    const { service, prisma, s3Service } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(
      createDocument({ status: 'pending' }),
    );

    await expect(
      service.uploadDocument(createFile(), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.studentVerificationDocument.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['pending', 'approved'] },
      },
    });
    expect(s3Service.uploadFile).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.studentVerificationDocument.create).not.toHaveBeenCalled();
    expect(prisma.studentVerificationLog.create).not.toHaveBeenCalled();
  });

  it('rejects uploads while an approved document already exists', async () => {
    const { service, prisma, s3Service } = createContext();
    prisma.studentVerificationDocument.findFirst.mockResolvedValue(
      createDocument({ status: 'approved' }),
    );

    await expect(
      service.uploadDocument(createFile(), 'user-1'),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(s3Service.uploadFile).not.toHaveBeenCalled();
  });

  it('stores a pending PDF document with verification metadata and an audit log', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const savedDocument = createDocument({
      id: 'document-new',
      authenticationCode: 'AUTH-CODE',
      documentEmissionDate: new Date('2026-01-02'),
      documentExpirationDate: new Date('2026-12-31'),
      isDocumentValid: true,
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: true,
        authCode: 'AUTH-CODE-FROM-VERIFIER',
        emissionDate: '2026-01-02',
        expirationDate: '2026-12-31',
      },
    });
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result).toEqual({
      message: 'Documento enviado com sucesso! Aguarde a verificação.',
      documentId: 'document-new',
      status: 'pending',
      authenticationCode: 'AUTH-CODE',
      extractedName: undefined,
    });
    const uploadCall = s3Service.uploadFile.mock.calls[0];
    expect(uploadCall[0]).toBe(s3Key);
    expect(uploadCall[1]).toBe(file.buffer);
    expect(uploadCall[2]).toBe('application/pdf');
    const uploadMetadata = uploadCall[3] as UploadMetadata;
    expect(uploadMetadata.userId).toBe('user-1');
    expect(uploadMetadata.originalFileName).toBe('proof.pdf');
    expect(typeof uploadMetadata.uploadedAt).toBe('string');

    expect(tx.$queryRaw).toHaveBeenCalled();
    expect(tx.studentVerificationDocument.findFirst).toHaveBeenCalledWith({
      where: {
        userId: 'user-1',
        status: { in: ['pending', 'approved'] },
      },
    });

    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.userId).toBe('user-1');
    expect(createArgs.data.originalFileName).toBe('proof.pdf');
    expect(createArgs.data.filePath).toBe(s3Key);
    expect(createArgs.data.s3Key).toBe(s3Key);
    expect(createArgs.data.mimeType).toBe('application/pdf');
    expect(createArgs.data.fileSize).toBe(file.size);
    expect(createArgs.data.status).toBe('pending');
    expect(createArgs.data.rejectionReason).toBeNull();
    expect(createArgs.data.authenticationCode).toBe('AUTH-CODE');
    expect(createArgs.data.isDocumentValid).toBe(true);
    expect(createArgs.data.documentEmissionDate).toEqual(
      new Date('2026-01-02'),
    );
    expect(createArgs.data.documentExpirationDate).toEqual(
      new Date('2026-12-31'),
    );
    const logArgs = tx.studentVerificationLog.create.mock
      .calls[0][0] as VerificationLogCreateArgs;
    expect(logArgs.data.documentId).toBe('document-new');
    expect(logArgs.data.userId).toBe('user-1');
    expect(logArgs.data.action).toBe('upload');
    expect(logArgs.data.performedBy).toBe('system');
    expect(logArgs.data.reason).toBeNull();
    const logMetadata = logArgs.data.metadata as LogMetadata;
    expect(logMetadata.fileName).toBe('proof.pdf');
    expect(logMetadata.fileSize).toBe(file.size);
    expect(logMetadata.mimeType).toBe('application/pdf');
    expect(logMetadata.authenticationCode).toBe('AUTH-CODE');
    expect(logMetadata.isManualFallback).toBe(false);
  });

  it('records an automated rejection when PDF authenticity verification fails', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const rejectionReason = 'Documento invalido ou expirado';
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason,
      authenticationCode: 'AUTH-CODE',
      isDocumentValid: false,
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: false,
        authCode: 'AUTH-CODE',
        error: rejectionReason,
      },
    });
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');

    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.status).toBe('rejected');
    expect(createArgs.data.rejectionReason).toBe(rejectionReason);
    expect(createArgs.data.authenticationCode).toBe('AUTH-CODE');
    expect(createArgs.data.isDocumentValid).toBe(false);
    const logArgs = tx.studentVerificationLog.create.mock
      .calls[0][0] as VerificationLogCreateArgs;
    expect(logArgs.data.documentId).toBe('document-rejected');
    expect(logArgs.data.userId).toBe('user-1');
    expect(logArgs.data.action).toBe('automated_rejected');
    expect(logArgs.data.performedBy).toBe('automated');
    expect(logArgs.data.reason).toBe(rejectionReason);
  });

  it('records an automated rejection when PDF buffer verification throws', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile({
      originalname: 'comprovanteÃ©.pdf',
    });
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason:
        'Erro na verificação do PDF: Falha na verificação do documento PDF',
      authenticationCode: 'AUTH-CODE',
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockRejectedValue(
      'process failed',
    );
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');
    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.originalFileName).not.toBe('comprovanteÃ©.pdf');
    expect(createArgs.data.status).toBe('rejected');
    expect(createArgs.data.rejectionReason).toBe(
      'Erro na verificação do PDF: Falha na verificação do documento PDF',
    );
  });

  it('records verifier error messages when PDF buffer verification throws an Error', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason: 'Erro na verificação do PDF: verifier offline',
      authenticationCode: 'AUTH-CODE',
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockRejectedValue(
      new Error('verifier offline'),
    );
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');
    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.rejectionReason).toBe(
      'Erro na verificação do PDF: verifier offline',
    );
  });

  it('records an automated rejection when PDF auth-code extraction throws', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason: 'Erro na verificação do PDF: extraction failed',
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockRejectedValue(
      new Error('extraction failed'),
    );
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');
    expect(
      pdfVerificationService.verifyPdfDocumentFromBuffer,
    ).not.toHaveBeenCalled();
  });

  it('records the default extraction error when PDF auth-code extraction throws a non-Error value', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason:
        'Erro na verificação do PDF: Falha na extração do código de autenticidade',
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockRejectedValue(
      'extraction failed',
    );
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');
    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.rejectionReason).toBe(
      'Erro na verificação do PDF: Falha na extração do código de autenticidade',
    );
    expect(
      pdfVerificationService.verifyPdfDocumentFromBuffer,
    ).not.toHaveBeenCalled();
  });

  it('uses the default rejection reason for invalid PDFs without verifier errors', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const savedDocument = createDocument({
      id: 'document-rejected',
      status: 'rejected',
      rejectionReason: 'Documento inválido ou expirado',
      authenticationCode: 'AUTH-CODE',
      isDocumentValid: false,
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: false,
        authCode: 'AUTH-CODE',
      },
    });
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1');

    expect(result.status).toBe('rejected');
    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.rejectionReason).toBe(
      'Documento inválido ou expirado',
    );
  });

  it('accepts manual fallback text documents without PDF processing', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const buffer = Buffer.from('manual fallback proof');
    const file = createFile({
      originalname: 'manual-proof.txt',
      mimetype: 'text/plain',
      size: buffer.length,
      buffer,
      stream: Readable.from(buffer),
    });
    const savedDocument = createDocument({
      id: 'manual-document',
      originalFileName: 'manual-proof.txt',
      mimeType: 'text/plain',
      fileSize: file.size,
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1', true);

    expect(result.status).toBe('pending');
    expect(pdfProcessingService.extractAuthCodeFromPdf).not.toHaveBeenCalled();
    expect(
      pdfVerificationService.verifyPdfDocumentFromBuffer,
    ).not.toHaveBeenCalled();

    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.originalFileName).toBe('manual-proof.txt');
    expect(createArgs.data.mimeType).toBe('text/plain');
    expect(createArgs.data.status).toBe('pending');
    expect(createArgs.data.authenticationCode).toBeNull();
    expect(createArgs.data.isDocumentValid).toBeNull();
    const logArgs = tx.studentVerificationLog.create.mock
      .calls[0][0] as VerificationLogCreateArgs;
    expect(logArgs.data.action).toBe('upload');
    const logMetadata = logArgs.data.metadata as LogMetadata;
    expect(logMetadata.isManualFallback).toBe(true);
  });

  it('stores extensionless manual fallback uploads', async () => {
    const { service, s3Service, tx } = createContext();
    const buffer = Buffer.from('manual fallback proof');
    const file = createFile({
      originalname: '',
      mimetype: 'text/plain',
      size: buffer.length,
      buffer,
      stream: Readable.from(buffer),
    });
    const savedDocument = createDocument({
      id: 'extensionless-document',
      originalFileName: '',
      mimeType: 'text/plain',
      fileSize: file.size,
    });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    tx.studentVerificationDocument.create.mockResolvedValue(savedDocument);

    const result = await service.uploadDocument(file, 'user-1', true);

    expect(result.status).toBe('pending');
    const createArgs = tx.studentVerificationDocument.create.mock
      .calls[0][0] as DocumentCreateArgs;
    expect(createArgs.data.storedFileName).toBe(
      '00000000-0000-7000-8000-000000000001.',
    );
    expect(createArgs.data.originalFileName).toBe('');
  });

  it('deletes the S3 upload when transactional persistence fails', async () => {
    const {
      service,
      prisma,
      s3Service,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const persistenceError = new Error('database unavailable');

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: true,
      },
    });
    prisma.$transaction.mockRejectedValue(persistenceError);

    await expect(service.uploadDocument(file, 'user-1')).rejects.toThrow(
      persistenceError,
    );

    expect(s3Service.deleteFile).toHaveBeenCalledWith(s3Key);
  });

  it('still surfaces persistence errors when S3 cleanup throws an Error', async () => {
    const {
      service,
      prisma,
      s3Service,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();
    const persistenceError = new Error('database unavailable');

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    s3Service.deleteFile.mockRejectedValue(new Error('cleanup failed'));
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: true,
      },
    });
    prisma.$transaction.mockRejectedValue(persistenceError);

    await expect(service.uploadDocument(file, 'user-1')).rejects.toThrow(
      persistenceError,
    );

    expect(s3Service.deleteFile).toHaveBeenCalledWith(s3Key);
  });

  it('reports a generic save error when cleanup receives a non-error persistence failure', async () => {
    const {
      service,
      prisma,
      s3Service,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile({ originalname: 'proof' });

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    s3Service.deleteFile.mockRejectedValue('cleanup failed');
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: true,
      },
    });
    prisma.$transaction.mockRejectedValue('database unavailable');

    await expect(service.uploadDocument(file, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(s3Service.deleteFile).toHaveBeenCalledWith(s3Key);
  });

  it('deletes the S3 upload when a concurrent active document appears inside the transaction', async () => {
    const {
      service,
      s3Service,
      tx,
      pdfProcessingService,
      pdfVerificationService,
    } = createContext();
    const file = createFile();

    s3Service.uploadFile.mockResolvedValue({ key: s3Key, size: file.size });
    pdfProcessingService.extractAuthCodeFromPdf.mockResolvedValue('AUTH-CODE');
    pdfVerificationService.verifyPdfDocumentFromBuffer.mockResolvedValue({
      success: true,
      data: {
        isValid: true,
      },
    });
    tx.studentVerificationDocument.findFirst.mockResolvedValue(
      createDocument({ status: 'pending' }),
    );

    await expect(service.uploadDocument(file, 'user-1')).rejects.toBeInstanceOf(
      BadRequestException,
    );

    expect(tx.studentVerificationDocument.create).not.toHaveBeenCalled();
    expect(tx.studentVerificationLog.create).not.toHaveBeenCalled();
    expect(s3Service.deleteFile).toHaveBeenCalledWith(s3Key);
  });
});
