import { Readable } from 'stream';
import type { DeleteAccountRequest, LgpdRequest } from '@prisma/client';
import { S3Service, S3ServiceError } from '../common/services/s3.service';
import { Logger, ServiceUnavailableException } from '@nestjs/common';
import JSZip from 'jszip';
import { PrismaService } from '../prisma/prisma.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { UserService } from '../auth/services/user.service';
import { EventManagerGrpcClient } from '../grpc/event-manager-grpc.client';
import { DiscordLinkService } from '../discord/services/discord-link.service';
import { LgpdService } from './lgpd.service';

// Keep the fixture inside the seven-day active-request window used by processRequest.
const createdAt = new Date(Date.now() - 60 * 60 * 1000);

const createLgpdRequest = (overrides: Partial<LgpdRequest> = {}): LgpdRequest => ({
  id: 'lgpd-request-1',
  userId: 'user-1',
  email: 'user@example.com',
  status: 'pending',
  fileName: null,
  filePath: null,
  s3Key: null,
  fileSize: null,
  errorMessage: null,
  createdAt,
  updatedAt: createdAt,
  downloadedAt: null,
  expiresAt: null,
  ...overrides,
});

const createDeleteRequest = (overrides: Partial<DeleteAccountRequest> = {}): DeleteAccountRequest => ({
  id: 'delete-request-1',
  userId: 'user-1',
  email: 'user@example.com',
  status: 'pending',
  reason: 'Requested by user',
  servicesNotified: [],
  errorMessage: null,
  createdAt,
  updatedAt: createdAt,
  softDeletedAt: null,
  scheduledHardDeleteAt: new Date('2027-08-20T12:00:00.000Z'),
  cancelledAt: null,
  completedAt: null,
  ...overrides,
});

const createContext = () => {
  const request = createLgpdRequest();
  const deleteRequest = createDeleteRequest();
  const lgpdUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const lgpdFindUnique = jest.fn().mockResolvedValue(request);
  const lgpdFindMany = jest.fn().mockResolvedValue([]);
  const deleteUpdateMany = jest.fn().mockResolvedValue({ count: 1 });
  const deleteFindUnique = jest.fn().mockResolvedValue(deleteRequest);
  const deleteFindUniqueOrThrow = jest.fn().mockResolvedValue(deleteRequest);
  const deleteFindMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    lgpdRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: lgpdFindMany,
      findUnique: lgpdFindUnique,
      updateMany: lgpdUpdateMany,
      deleteMany: jest.fn(),
    },
    deleteAccountRequest: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: deleteFindMany,
      findUnique: deleteFindUnique,
      findUniqueOrThrow: deleteFindUniqueOrThrow,
      update: jest.fn(),
      updateMany: deleteUpdateMany,
      deleteMany: jest.fn(),
    },
    studentVerificationDocument: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn(),
  };

  const uploadFile = jest.fn().mockImplementation((key: string, input: Buffer | Readable | (() => Readable)) => {
    const body = typeof input === 'function' ? input() : input;
    if (Buffer.isBuffer(body)) {
      return Promise.resolve({ key, size: body.length });
    }

    return new Promise<{ key: string; size: number }>((resolve, reject) => {
      let size = 0;
      body.on('data', (chunk: Buffer) => {
        size += chunk.length;
      });
      body.once('error', reject);
      body.once('end', () => resolve({ key, size }));
      body.resume();
    });
  });
  const s3Service = {
    uploadFile,
    downloadFile: jest.fn().mockResolvedValue({ stream: Readable.from('archive') }),
    deleteFile: jest.fn().mockResolvedValue(undefined),
    generateFileKey: jest
      .fn()
      .mockImplementation((_category: string, _userId: string, filename: string) => `lgpd/${filename}`),
  };

  const userProfile = {
    id: 'local-user-1',
    email: 'user@example.com',
    fullname: 'User Example',
    displayName: 'User',
    phone: null,
    enrollmentNumber: null,
    identityDocument: null,
    isForeigner: false,
    isOnboarded: true,
    unespRole: 'aluno-graduacao',
    createdAt,
    updatedAt: createdAt,
  };
  const userService = {
    findByKeycloakId: jest.fn().mockResolvedValue(userProfile),
    deleteUserData: jest.fn().mockResolvedValue(undefined),
  };
  const keycloakService = {
    getUserAttributes: jest.fn().mockResolvedValue({ email: ['user@example.com'] }),
    getUserGroups: jest.fn().mockResolvedValue([]),
    getUserBasicInfo: jest.fn().mockResolvedValue({ id: 'user-1', email: 'user@example.com', attributes: {} }),
    setUserEnabled: jest.fn().mockResolvedValue(undefined),
    updateUserAttributes: jest.fn().mockResolvedValue(undefined),
    deleteUser: jest.fn().mockResolvedValue(undefined),
  };
  const eventManagerGrpc = {
    collectLgpdData: jest.fn().mockResolvedValue({}),
    scheduleLgpdDeletion: jest.fn().mockResolvedValue(undefined),
    cancelLgpdDeletion: jest.fn().mockResolvedValue(undefined),
    deleteLgpdData: jest.fn().mockResolvedValue(undefined),
  };
  const discordLinkService = {
    getAllDiscordLinksForUser: jest.fn().mockResolvedValue([]),
  };
  const lgpdQueue = {
    add: jest.fn().mockResolvedValue({ remove: jest.fn() }),
  };

  const service = new LgpdService(
    prisma as unknown as PrismaService,
    keycloakService as unknown as KeycloakService,
    userService as unknown as UserService,
    eventManagerGrpc as unknown as EventManagerGrpcClient,
    discordLinkService as unknown as DiscordLinkService,
    s3Service as unknown as S3Service,
    lgpdQueue as never,
  );

  return {
    service,
    prisma,
    request,
    deleteRequest,
    s3Service,
    userService,
    keycloakService,
    eventManagerGrpc,
    discordLinkService,
    lgpdQueue,
  };
};

describe('LgpdService durability', () => {
  beforeEach(() => {
    delete process.env.LGPD_GRPC_BACKENDS;
    delete process.env.LGPD_DELETION_GRPC_BACKENDS;
  });

  it('allows only one concurrent data processor to claim a pending request', async () => {
    const context = createContext();
    let claimCount = 0;
    context.prisma.lgpdRequest.updateMany.mockImplementation((args: { data?: { status?: string } }) => {
      if (args.data?.status === 'processing') {
        claimCount += 1;
        return Promise.resolve({ count: claimCount === 1 ? 1 : 0 });
      }
      return Promise.resolve({ count: 1 });
    });

    await Promise.all([
      context.service.processRequest('lgpd-request-1'),
      context.service.processRequest('lgpd-request-1'),
    ]);

    expect(context.userService.findByKeycloakId).toHaveBeenCalledTimes(1);
    expect(context.s3Service.uploadFile).toHaveBeenCalledTimes(1);
  });

  it('does not complete an export when a mandatory source fails', async () => {
    const context = createContext();
    context.keycloakService.getUserAttributes.mockRejectedValue(new Error('Keycloak unavailable'));

    await context.service.processRequest('lgpd-request-1');

    expect(context.s3Service.uploadFile).not.toHaveBeenCalled();
    expect(context.prisma.lgpdRequest.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: { id: 'lgpd-request-1', status: 'processing' },
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        data: expect.objectContaining({ status: 'failed' }),
      }),
    );
  });

  it('keeps optional Discord collection failures disclosed while completing the archive', async () => {
    const context = createContext();
    context.discordLinkService.getAllDiscordLinksForUser.mockRejectedValue(new Error('Discord unavailable'));

    await context.service.processRequest('lgpd-request-1');

    expect(context.s3Service.uploadFile).toHaveBeenCalledTimes(1);
    expect(context.prisma.lgpdRequest.updateMany).toHaveBeenLastCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ data: expect.objectContaining({ status: 'completed' }) }),
    );
  });

  it('does not return provider error details in a failed data request DTO', async () => {
    const context = createContext();
    const providerError = 'https://private-storage.internal/access?token=secret';
    context.prisma.lgpdRequest.findFirst.mockResolvedValue(
      createLgpdRequest({ status: 'failed', errorMessage: providerError }),
    );

    const request = await context.service.getRequestById('lgpd-request-1', 'user-1');

    expect(request.errorMessage).toBe(
      'Não foi possível gerar o arquivo com seus dados. Fale com o suporte para solicitar uma nova tentativa.',
    );
    expect(request.errorMessage).not.toContain(providerError);
  });

  it('distinguishes a missing LGPD archive from a temporary storage failure', async () => {
    const missingContext = createContext();
    const providerError = new S3ServiceError(
      'missing object at https://private-storage.internal/bucket/key?token=secret',
      'download',
      'private-key',
      404,
      'NoSuchKey',
    );
    missingContext.prisma.lgpdRequest.findFirst.mockResolvedValue(
      createLgpdRequest({ status: 'completed', s3Key: 'lgpd/private-key' }),
    );
    missingContext.s3Service.downloadFile.mockRejectedValueOnce(providerError);

    await expect(missingContext.service.downloadFile('lgpd-request-1', 'user-1')).rejects.toMatchObject({
      status: 404,
      message: 'O arquivo de dados não está disponível. Fale com o suporte para solicitar outra cópia.',
    });
  });

  it.each([
    new Error('Storage unavailable at https://storage.example.test/archive?token=private'),
    new S3ServiceError(
      'Storage unavailable at https://storage.example.test/archive?token=private',
      'download',
      'private-key',
      503,
      'ServiceUnavailable',
      true,
    ),
  ])('logs only safe diagnostics when an archive download fails (%p)', async (error) => {
    const context = createContext();
    const logError = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    context.prisma.lgpdRequest.findFirst.mockResolvedValue(
      createLgpdRequest({ status: 'completed', s3Key: 'lgpd/private-key' }),
    );
    context.s3Service.downloadFile.mockRejectedValueOnce(error);

    try {
      await expect(context.service.downloadFile('lgpd-request-1', 'user-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(logError).toHaveBeenCalledWith('Failed to retrieve LGPD archive for download', {
        operation: 'download',
        requestId: 'lgpd-request-1',
        ...(error instanceof S3ServiceError && { statusCode: 503, retryable: true }),
      });
      expect(JSON.stringify(logError.mock.calls)).not.toContain('private');
      expect(JSON.stringify(logError.mock.calls)).not.toContain(error.message);
    } finally {
      logError.mockRestore();
    }
  });

  it('shows admins failed deletion steps without exposing provider error details', async () => {
    const context = createContext();
    const providerError = 'https://private-identity.internal/admin?token=secret';
    context.prisma.deleteAccountRequest.findMany.mockResolvedValue([
      createDeleteRequest({
        status: 'failed',
        errorMessage: JSON.stringify({
          failures: [{ service: 'keycloak', operation: 'deleteUser', message: providerError }],
          remainingServices: ['keycloak.deleteUser'],
          partialState: 'partially_disabled',
        }),
      }),
    ]);

    const [request] = await context.service.getPendingAccountDeletionRequests();

    expect(request?.errorMessage).toContain('A exclusão ficou incompleta.');
    expect(request?.errorMessage).toContain('serviço de autenticação');
    expect(request?.errorMessage).toContain('excluir a conta');
    expect(request?.errorMessage).toContain('A conta pode ter sido desativada parcialmente.');
    expect(request?.errorMessage).not.toContain(providerError);
  });

  it('returns a safe recovery message when account deletion cancellation cannot restore access', async () => {
    const context = createContext();
    const providerError = new Error('https://private-identity.internal/admin?token=secret');
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    context.keycloakService.setUserEnabled.mockRejectedValueOnce(providerError);

    try {
      await expect(context.service.undoAccountDeletionRequest('delete-request-1')).rejects.toBeInstanceOf(
        ServiceUnavailableException,
      );
      const updateCalls = context.prisma.deleteAccountRequest.updateMany.mock.calls as unknown[][];
      const reconciliationUpdate = updateCalls.at(-1)?.[0] as { data?: { errorMessage?: string } } | undefined;
      expect(reconciliationUpdate?.data?.errorMessage).toContain(providerError.message);
      expect(log).toHaveBeenCalledWith('Failed to reconcile cancelled account deletion', {
        requestId: 'delete-request-1',
        error: providerError,
      });
    } finally {
      log.mockRestore();
    }
  });

  it('persists one deterministic archive key before upload so finalization recovery cannot orphan retries', async () => {
    const context = createContext();
    context.prisma.lgpdRequest.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error('database timeout'));

    await expect(context.service.processRequest('lgpd-request-1')).resolves.toBeUndefined();

    const updateCalls = context.prisma.lgpdRequest.updateMany.mock.calls as unknown[][];
    const preparationCall = updateCalls[1];
    if (!preparationCall) {
      throw new Error('Expected archive preparation call');
    }
    const preparation = preparationCall[0] as {
      data: { s3Key: string; fileName: string };
    };
    expect(preparation.data.s3Key).toContain('lgpd/dados-lgpd-user-1-lgpd-request-1.zip');
    expect(context.s3Service.uploadFile).toHaveBeenCalledWith(
      preparation.data.s3Key,
      expect.any(Function),
      'application/zip',
      expect.any(Object),
    );
  });

  it('rebuilds complete ZIP streams for retries without recollecting data', async () => {
    const context = createContext();
    const archives: Buffer[] = [];
    context.s3Service.uploadFile.mockImplementation(async (key: string, factory: () => Readable) => {
      for (let attempt = 0; attempt < 2; attempt++) {
        const chunks: Buffer[] = [];
        for await (const chunk of factory()) chunks.push(chunk as Buffer);
        archives.push(Buffer.concat(chunks));
      }
      return { key, size: archives[1].length };
    });

    await context.service.processRequest('lgpd-request-1');

    for (const buffer of archives) {
      const zip = await JSZip.loadAsync(buffer);
      const summary = zip.file('resumo.json');
      expect(summary).not.toBeNull();
      expect(JSON.parse(await summary!.async('string')) as unknown).toEqual(
        expect.objectContaining({ usuario_id: 'user-1' }),
      );
      expect(zip.file('cacic-sso/perfil_usuario.json')).not.toBeNull();
    }
    expect(context.userService.findByKeycloakId).toHaveBeenCalledTimes(1);
    expect(context.s3Service.generateFileKey).toHaveBeenCalledTimes(1);
  });

  it('retains provider diagnostics in the LGPD failure log and marks exhausted uploads failed', async () => {
    const context = createContext();
    const log = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const storageError = new S3ServiceError(
      'upload inactivity timeout after 120000ms',
      'upload',
      'lgpd/same-key',
      undefined,
      'AbortError',
      true,
      { cause: new Error('Upload aborted.') },
      { attempt: 3, timeoutReason: 'idle', bytesRead: 42, provider: { requestId: 'provider-1' } },
    );
    context.s3Service.uploadFile.mockRejectedValue(storageError);
    try {
      await context.service.processRequest('lgpd-request-1');

      expect(log).toHaveBeenCalledWith(
        expect.objectContaining({
          requestId: 'lgpd-request-1',
          operation: 'upload',
          retryable: true,
          storage: storageError.diagnostics,
        }),
        storageError.stack,
      );
      expect(context.prisma.lgpdRequest.updateMany).toHaveBeenLastCalledWith({
        where: { id: 'lgpd-request-1', status: 'processing' },
        data: { status: 'failed', errorMessage: storageError.message },
      });
    } finally {
      log.mockRestore();
    }
  });

  it('does not delete application rows when a hard-delete storage obligation fails', async () => {
    const context = createContext();
    context.prisma.lgpdRequest.findMany.mockResolvedValue([
      { id: 'export-1', s3Key: 'lgpd/export-1.zip', filePath: null },
    ]);
    context.prisma.studentVerificationDocument.findMany.mockResolvedValue([]);
    context.s3Service.deleteFile.mockRejectedValue(new Error('storage unavailable'));

    await context.service.processAccountHardDeletion('delete-request-1');

    expect(context.prisma.$transaction).not.toHaveBeenCalled();
    expect(context.userService.deleteUserData).not.toHaveBeenCalled();
    expect(context.prisma.deleteAccountRequest.updateMany).toHaveBeenLastCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('records cancellation before external compensation and prevents a later worker claim', async () => {
    const context = createContext();
    const callOrder: string[] = [];
    context.prisma.deleteAccountRequest.updateMany.mockImplementation((args: { data?: { status?: string } }) => {
      if (args.data?.status === 'completed') callOrder.push('cancel-recorded');
      else callOrder.push('db-update');
      return Promise.resolve({ count: 1 });
    });
    context.keycloakService.setUserEnabled.mockImplementation(() => {
      callOrder.push('keycloak-enabled');
      return Promise.resolve();
    });

    await context.service.undoAccountDeletionRequest('delete-request-1');

    expect(callOrder[0]).toBe('cancel-recorded');
    expect(callOrder).toContain('keycloak-enabled');
  });

  it('recovers queue handoffs with deterministic operation ids', async () => {
    const context = createContext();
    context.prisma.deleteAccountRequest.findMany
      .mockResolvedValueOnce([context.deleteRequest])
      .mockResolvedValueOnce([context.deleteRequest]);

    await expect(context.service.enqueuePendingSoftDeletions()).resolves.toBe(1);
    await expect(context.service.enqueueDueHardDeletions()).resolves.toBe(1);

    expect(context.lgpdQueue.add).toHaveBeenNthCalledWith(
      1,
      'soft-delete-account',
      { requestId: 'delete-request-1' },
      { jobId: 'lgpd-soft-delete-delete-request-1' },
    );
    expect(context.lgpdQueue.add).toHaveBeenNthCalledWith(
      2,
      'hard-delete-account',
      { requestId: 'delete-request-1' },
      { jobId: 'lgpd-hard-delete-delete-request-1' },
    );
  });

  it('compensates a soft deletion when attribute persistence fails', async () => {
    const context = createContext();
    context.keycloakService.updateUserAttributes
      .mockRejectedValueOnce(new Error('attribute write failed'))
      .mockResolvedValueOnce(undefined);

    await context.service.processAccountSoftDeletion('delete-request-1');

    expect(context.keycloakService.setUserEnabled).toHaveBeenNthCalledWith(1, 'user-1', false);
    expect(context.keycloakService.setUserEnabled).toHaveBeenNthCalledWith(2, 'user-1', true);
    expect(context.prisma.deleteAccountRequest.updateMany).toHaveBeenLastCalledWith(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      expect.objectContaining({ data: expect.objectContaining({ status: 'failed' }) }),
    );
  });

  it('marks delivery only after the download stream has been obtained for response piping', async () => {
    const context = createContext();
    const request = createLgpdRequest({ status: 'completed', s3Key: 'lgpd/export.zip' });
    context.prisma.lgpdRequest.findFirst.mockResolvedValue(request);

    await context.service.downloadFile(request.id, request.userId);

    expect(context.prisma.lgpdRequest.updateMany).not.toHaveBeenCalled();
    await context.service.markDownloadDelivered(request.id, request.userId);
    expect(context.prisma.lgpdRequest.updateMany).toHaveBeenCalledWith({
      where: { id: request.id, userId: request.userId, status: 'completed' },
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      data: { downloadedAt: expect.any(Date) },
    });
  });
});
