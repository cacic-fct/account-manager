import { Readable } from 'stream';
import type { DeleteAccountRequest, LgpdRequest } from '@prisma/client';
import { S3Service } from '../common/services/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import { KeycloakService } from '../auth/services/keycloak.service';
import { UserService } from '../auth/services/user.service';
import { EventManagerGrpcClient } from '../grpc/event-manager-grpc.client';
import { DiscordLinkService } from '../discord/services/discord-link.service';
import { LgpdService } from './lgpd.service';

const createdAt = new Date('2026-08-20T12:00:00.000Z');

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

  const uploadFile = jest.fn().mockImplementation((key: string, body: Buffer | Readable) => {
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
      expect.any(Readable),
      'application/zip',
      expect.any(Object),
    );
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
