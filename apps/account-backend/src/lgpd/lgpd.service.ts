/**
 * LGPD Service - Lei Geral de Proteção de Dados (Brazilian Data Protection Law)
 *
 * SECURITY MEASURES:
 * 1. All endpoints require authentication via session
 * 2. Database queries filter by userId to prevent cross-user access
 * 3. Additional validation ensures request ownership matches session user
 * 4. File access is restricted to completed requests owned by the user
 * 5. Files expire after 7 days and are automatically cleaned up
 * 6. Rate limiting prevents abuse (1 request per 24 hours)
 *
 * COMPLIANCE:
 * - Implements LGPD Article 18 (Right to data portability)
 * - Provides structured data export in human-readable format
 * - Maintains audit trail of all requests
 * - Ensures data minimization and purpose limitation
 */

import { status } from '@grpc/grpc-js';
import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
} from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { DeleteAccountRequest, LgpdRequest } from '@prisma/client';
import { Queue } from 'bullmq';
import { LgpdRequestDto, LgpdRequestListDto } from './dto/lgpd-request.dto';
import {
  AdminDeleteAccountRequestDto,
  DeleteAccountRequestDto,
  DeleteAccountResponseDto,
} from './dto/delete-account.dto';
import { AccountDeletionJob, LGPD_JOBS, LGPD_QUEUE, ProcessDataRequestJob } from './lgpd.queue';
import { KeycloakService } from '../auth/services/keycloak.service';
import { UserService } from '../auth/services/user.service';
import { EventManagerGrpcClient } from '../grpc/event-manager-grpc.client';
import { DiscordLinkService } from '../discord/services/discord-link.service';
import { S3Service } from '../common/services/s3.service';
import { PrismaService } from '../prisma/prisma.service';
import archiver from 'archiver';
import { PassThrough, Readable } from 'stream';
import {
  LGPD_ACTIVE_REQUEST_EXPIRATION_MS,
  LGPD_ACTIVE_REQUEST_EXPIRED_MESSAGE,
  type AccountDeletionFailure,
} from './lgpd.constants';

interface LgpdCollectionResult {
  data: Record<string, unknown>;
  mandatoryErrors: string[];
  optionalWarnings: string[];
}

class LgpdCollectionError extends Error {
  constructor(readonly sources: string[]) {
    super(`Mandatory LGPD data sources failed: ${sources.join(', ')}`);
    this.name = 'LgpdCollectionError';
  }
}

@Injectable()
export class LgpdService {
  private readonly logger = new Logger(LgpdService.name);
  private readonly externalRequestTimeoutMs = 30_000;
  private readonly operationLeaseMs = 30 * 60 * 1000;
  private readonly cleanupPageSize = 100;

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
    private userService: UserService,
    private eventManagerGrpc: EventManagerGrpcClient,
    private discordLinkService: DiscordLinkService,
    private s3Service: S3Service,
    @InjectQueue(LGPD_QUEUE)
    private readonly lgpdQueue: Queue<ProcessDataRequestJob | AccountDeletionJob>,
  ) {}

  async createRequest(userId: string, email: string): Promise<LgpdRequestDto> {
    await this.expireStaleActiveRequests(userId);

    const oneDayAgo = new Date();
    oneDayAgo.setDate(oneDayAgo.getDate() - 1);

    const existingRequest = await this.prisma.lgpdRequest.findFirst({
      where: {
        userId,
        OR: [{ status: 'pending' }, { status: 'processing' }, { createdAt: { gt: oneDayAgo } }],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingRequest) {
      throw new BadRequestException(
        'Você já tem uma solicitação de dados pendente ou foi feita uma solicitação nas últimas 24 horas. Aguarde antes de fazer uma nova solicitação.',
      );
    }

    const saved = await this.prisma.lgpdRequest.create({
      data: {
        userId,
        email,
        status: 'pending',
      },
    });

    try {
      await this.lgpdQueue.add(
        LGPD_JOBS.PROCESS_DATA_REQUEST,
        { requestId: saved.id },
        { jobId: `lgpd-data-${saved.id}` },
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue LGPD data request ${saved.id}`, error);
      await this.prisma.lgpdRequest.update({
        where: { id: saved.id },
        data: {
          status: 'failed',
          errorMessage: this.serializeFailureDetails('lgpdQueue.add.process-data-request', error),
        },
      });
      throw new InternalServerErrorException('Não foi possível enfileirar a solicitação de dados.');
    }

    return this.toDto(saved);
  }

  async getRequestById(id: string, userId: string): Promise<LgpdRequestDto> {
    await this.expireStaleActiveRequests(userId);

    const request = await this.prisma.lgpdRequest.findFirst({
      where: { id, userId },
    });

    if (!request) {
      throw new NotFoundException('Solicitação não encontrada');
    }

    this.validateUserOwnership(request.userId, userId);

    return this.toDto(request);
  }

  async getUserRequests(userId: string): Promise<LgpdRequestListDto[]> {
    await this.expireStaleActiveRequests(userId);

    const requests = await this.prisma.lgpdRequest.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return requests.map((request) => this.toListDto(request));
  }

  async downloadFile(id: string, userId: string): Promise<{ stream: Readable; fileName: string }> {
    const request = await this.prisma.lgpdRequest.findFirst({
      where: { id, userId, status: 'completed' },
    });

    if (!request) {
      throw new NotFoundException('Arquivo não encontrado ou solicitação não concluída');
    }

    this.validateUserOwnership(request.userId, userId);

    if (request.expiresAt && new Date() > request.expiresAt) {
      throw new BadRequestException('O link para download expirou');
    }

    if (!request.s3Key) {
      throw new NotFoundException('Arquivo não encontrado no servidor');
    }

    try {
      const { stream } = await this.s3Service.downloadFile(request.s3Key);

      return {
        stream,
        fileName: request.fileName || 'dados-lgpd.zip',
      };
    } catch {
      throw new NotFoundException('Arquivo não pôde ser baixado do servidor');
    }
  }

  async markDownloadDelivered(id: string, userId: string): Promise<void> {
    await this.prisma.lgpdRequest.updateMany({
      where: { id, userId, status: 'completed' },
      data: { downloadedAt: new Date() },
    });
  }

  async processRequest(requestId: string): Promise<void> {
    const request = await this.claimLgpdRequest(requestId);
    if (!request) return;

    if (this.isActiveRequestExpired(request)) {
      await this.markActiveRequestExpired(requestId);
      return;
    }

    let archiveUploaded = false;
    let finalizationStarted = false;

    try {
      const collection = await this.collectUserData(request.userId);
      if (collection.mandatoryErrors.length > 0) {
        throw new LgpdCollectionError(collection.mandatoryErrors);
      }

      if (collection.optionalWarnings.length > 0) {
        collection.data.erros_coleta_opcionais = collection.optionalWarnings;
      }

      const { s3Key, fileName, fileSize } = await this.createAndUploadZipFile(
        requestId,
        request.userId,
        collection.data,
        request.s3Key,
      );
      archiveUploaded = true;

      finalizationStarted = true;
      const finalized = await this.prisma.lgpdRequest.updateMany({
        where: { id: requestId, status: 'processing', s3Key },
        data: {
          status: 'completed',
          s3Key,
          fileName,
          fileSize,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });

      if (finalized.count === 0) {
        throw new Error(`LGPD request ${requestId} changed before archive finalization`);
      }
    } catch (error) {
      this.logger.error(`Error processing LGPD request ${requestId}`, error);

      // Once an upload has been acknowledged, s3Key was persisted before the upload. Leave the
      // row in processing if finalization failed so a lease-recovered worker can finalize/overwrite
      // the deterministic object rather than creating an orphan archive.
      if (archiveUploaded && finalizationStarted) {
        return;
      }

      await this.prisma.lgpdRequest.updateMany({
        where: { id: requestId, status: 'processing' },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private async claimLgpdRequest(requestId: string): Promise<LgpdRequest | null> {
    const staleBefore = new Date(Date.now() - this.operationLeaseMs);
    const claimed = await this.prisma.lgpdRequest.updateMany({
      where: {
        id: requestId,
        OR: [{ status: 'pending' }, { status: 'processing', updatedAt: { lt: staleBefore } }],
      },
      data: { status: 'processing', errorMessage: null },
    });

    if (claimed.count === 0) {
      return null;
    }

    return this.prisma.lgpdRequest.findUnique({ where: { id: requestId } });
  }

  private async collectUserData(userId: string): Promise<LgpdCollectionResult> {
    const data: Record<string, unknown> = {};
    const mandatoryErrors: string[] = [];
    const optionalWarnings: string[] = [];
    let userProfile: Awaited<ReturnType<UserService['findByKeycloakId']>> = null;

    try {
      userProfile = await this.userService.findByKeycloakId(userId);
      if (userProfile) {
        data.perfil_usuario = {
          id: userProfile.id,
          email: userProfile.email,
          nome_completo: userProfile.fullname,
          nome_exibicao: userProfile.displayName,
          telefone: userProfile.phone,
          numero_matricula: userProfile.enrollmentNumber,
          documento_identidade: userProfile.identityDocument,
          estrangeiro: userProfile.isForeigner,
          cadastro_completo: userProfile.isOnboarded,
          papel_unesp: userProfile.unespRole,
          data_criacao: userProfile.createdAt,
          data_atualizacao: userProfile.updatedAt,
        };
      } else {
        mandatoryErrors.push('perfil_usuario');
      }
    } catch (error) {
      this.logger.error('Error collecting user profile data', error);
      mandatoryErrors.push('perfil_usuario');
    }

    try {
      const keycloakAttributes = await this.keycloakService.getUserAttributes(userId);
      if (keycloakAttributes) data.atributos_cacic_sso = keycloakAttributes;
      else mandatoryErrors.push('atributos_cacic_sso');
    } catch (error) {
      this.logger.error('Error collecting Keycloak attributes', error);
      mandatoryErrors.push('atributos_cacic_sso');
    }

    try {
      const userGroups = await this.keycloakService.getUserGroups(userId);
      if (userGroups) data.grupos_cacic_sso = userGroups;
      else mandatoryErrors.push('grupos_cacic_sso');
    } catch (error) {
      this.logger.error('Error collecting Keycloak groups', error);
      mandatoryErrors.push('grupos_cacic_sso');
    }

    try {
      const basicInfo = await this.keycloakService.getUserBasicInfo(userId);
      if (basicInfo) {
        data.informacoes_basicas_cacic_sso = {
          id: basicInfo.id,
          email: basicInfo.email,
          atributos: basicInfo.attributes,
        };
      } else {
        mandatoryErrors.push('informacoes_basicas_cacic_sso');
      }
    } catch (error) {
      this.logger.error('Error collecting Keycloak basic info', error);
      mandatoryErrors.push('informacoes_basicas_cacic_sso');
    }

    try {
      const lgpdHistory = await this.prisma.lgpdRequest.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
      });

      data.historico_solicitacoes_lgpd = lgpdHistory.map((req) => ({
        id: req.id,
        status: req.status,
        data_criacao: req.createdAt,
        data_atualizacao: req.updatedAt,
        data_download: req.downloadedAt,
        data_expiracao: req.expiresAt,
        nome_arquivo: req.fileName,
        tamanho_arquivo: req.fileSize,
        mensagem_erro: req.errorMessage,
      }));
    } catch (error) {
      this.logger.error('Error collecting LGPD request history', error);
      mandatoryErrors.push('historico_solicitacoes_lgpd');
    }

    try {
      const discordLinks = await this.discordLinkService.getAllDiscordLinksForUser(userId, true);
      data.contas_discord_vinculadas = discordLinks.map((link) => ({
        id: link.id,
        discord_id: link.discordId,
        discord_username: link.discordUsername,
        discord_nome_global: link.discordGlobalName,
        discord_avatar_hash: link.discordAvatarHash,
        verificado: link.isVerified,
        papel_atribuido: link.assignedRole,
        servidor_convite_usado: link.serverInviteUsed,
        data_criacao: link.createdAt,
        data_atualizacao: link.updatedAt,
        excluido: link.deleted,
        data_exclusao: link.deletedAt,
        status: link.deleted ? 'desvinculado' : 'ativo',
      }));
    } catch (error) {
      this.logger.error('Error collecting Discord links data', error);
      optionalWarnings.push('contas_discord_vinculadas');
      data.contas_discord_vinculadas = {
        erro: 'Erro ao coletar dados de contas Discord',
        detalhes: error instanceof Error ? error.message : 'Unknown error',
      };
    }

    const external = await this.collectExternalData(userId, userProfile?.email || '');
    Object.assign(data, external.data);
    mandatoryErrors.push(...external.errors);

    return { data, mandatoryErrors, optionalWarnings };
  }

  private async collectExternalData(
    userId: string,
    email: string,
  ): Promise<{ data: Record<string, unknown>; errors: string[] }> {
    const externalData: Record<string, unknown> = {};
    const errors: string[] = [];
    const backends = this.getExternalLgpdBackends();

    await Promise.all(
      backends.map(async (backend) => {
        const category = backend.category || this.normalizeCategoryName(backend.name);

        try {
          externalData[category] = await this.eventManagerGrpc.collectLgpdData(backend.target, backend.audience, {
            userId,
            email,
          });
        } catch (error) {
          this.logger.error(`Error collecting external LGPD data from ${backend.name}`, error);
          externalData[category] = {
            erro: `Erro ao coletar dados de ${backend.name}`,
            detalhes: error instanceof Error ? error.message : 'Unknown error',
            data_erro: new Date().toISOString(),
          };
          errors.push(category);
        }
      }),
    );

    return { data: externalData, errors };
  }

  private async createAndUploadZipFile(
    requestId: string,
    userId: string,
    userData: Record<string, unknown>,
    existingS3Key?: string | null,
  ): Promise<{ s3Key: string; fileName: string; fileSize: number }> {
    const generationDate = new Date();
    const timestamp = generationDate.toISOString().replace(/[:.]/g, '-');
    // The request id is part of the name so recovery overwrites one deterministic object instead of
    // producing a new unreferenced archive on every retry.
    const fileName = `dados-lgpd-${userId.substring(0, 8)}-${requestId}.zip`;
    const s3Key = existingS3Key ?? this.s3Service.generateFileKey('lgpd', userId, fileName, generationDate);

    if (!existingS3Key) {
      const prepared = await this.prisma.lgpdRequest.updateMany({
        where: { id: requestId, status: 'processing', s3Key: null },
        data: { s3Key, fileName },
      });
      if (prepared.count === 0) {
        throw new Error(`LGPD request ${requestId} changed before archive preparation`);
      }
    }

    const archive = archiver('zip', { zlib: { level: 9 } });
    const uploadStream = new PassThrough();
    const uploadResultPromise = this.s3Service
      .uploadFile(s3Key, uploadStream, 'application/zip', {
        userId,
        requestType: 'lgpd_data_export',
        createdAt: timestamp,
      })
      .catch((error) => {
        throw new Error(`Failed to upload to S3: ${this.getErrorMessage(error)}`);
      });

    archive.on('error', (error) => {
      uploadStream.destroy(error);
    });
    archive.pipe(uploadStream);

    const cacicSsoCategories = [
      'perfil_usuario',
      'atributos_cacic_sso',
      'grupos_cacic_sso',
      'informacoes_basicas_cacic_sso',
    ];

    Object.entries(userData).forEach(([category, data]) => {
      if (category === 'event_manager' && this.isRecord(data)) {
        Object.entries(data).forEach(([eventManagerCategory, eventManagerData]) => {
          archive.append(JSON.stringify(eventManagerData, null, 2), {
            name: `event_manager/${eventManagerCategory}.json`,
          });
        });
        return;
      }

      const jsonContent = JSON.stringify(data, null, 2);
      const fileNameInZip = cacicSsoCategories.includes(category) ? `cacic-sso/${category}.json` : `${category}.json`;

      archive.append(jsonContent, { name: fileNameInZip });
    });

    const summary = {
      data_geracao: new Date().toISOString(),
      usuario_id: userId,
      categorias_dados: Object.keys(userData),
      observacoes: {
        lgpd: 'Dados coletados conforme Lei Geral de Proteção de Dados (LGPD)',
        validade: 'Este arquivo expira em 7 dias a partir da data de geração',
        suporte: 'Para dúvidas, entre em contato com o suporte técnico',
      },
    };

    archive.append(JSON.stringify(summary, null, 2), { name: 'resumo.json' });

    try {
      await archive.finalize();
      const uploadResult = await uploadResultPromise;

      return {
        s3Key: uploadResult.key,
        fileName,
        fileSize: uploadResult.size,
      };
    } catch (error) {
      archive.destroy();
      uploadStream.destroy(error instanceof Error ? error : new Error(String(error)));
      throw error;
    }
  }

  async cleanupExpiredFiles(): Promise<number> {
    const now = new Date();
    const deletedRequestIds: string[] = [];
    const seenRequestIds = new Set<string>();
    let cursor: string | undefined;

    while (true) {
      const expiredRequests = await this.prisma.lgpdRequest.findMany({
        where: {
          status: 'completed',
          expiresAt: { lt: now },
          ...(cursor ? { id: { gt: cursor } } : {}),
        },
        orderBy: { id: 'asc' },
        take: this.cleanupPageSize,
      });

      const newRequests = expiredRequests.filter((request) => !seenRequestIds.has(request.id));
      if (newRequests.length === 0) {
        break;
      }

      for (const request of newRequests) {
        seenRequestIds.add(request.id);
        cursor = request.id;
        if (!request.s3Key) {
          continue;
        }

        try {
          await this.s3Service.deleteFile(request.s3Key);
          deletedRequestIds.push(request.id);
          this.logger.debug(`Deleted expired LGPD file from S3: ${request.s3Key}`);
        } catch (error) {
          this.logger.error(`Error deleting S3 file ${request.s3Key}`, error);
          // Keep the object reference and persist the failure so the next scheduler run has a
          // durable retry obligation instead of silently forgetting the object.
          await this.prisma.lgpdRequest.updateMany({
            where: { id: request.id, status: 'completed', s3Key: request.s3Key },
            data: { errorMessage: this.serializeFailureDetails('cleanupExpiredFiles', error) },
          });
        }
      }

      if (newRequests.length < this.cleanupPageSize) {
        break;
      }
    }

    if (deletedRequestIds.length > 0) {
      await this.prisma.$transaction([
        this.prisma.lgpdRequest.updateMany({
          where: { id: { in: deletedRequestIds } },
          data: {
            filePath: null,
            fileName: null,
            fileSize: null,
            s3Key: null,
          },
        }),
        this.prisma.lgpdRequest.deleteMany({
          where: { id: { in: deletedRequestIds } },
        }),
      ]);
    }

    return deletedRequestIds.length;
  }

  async cleanupExpiredRequests(): Promise<number> {
    return this.expireStaleActiveRequests();
  }

  async enqueueDueHardDeletions(): Promise<number> {
    let enqueued = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const requests = await this.prisma.deleteAccountRequest.findMany({
        where: {
          status: { in: ['pending', 'failed'] },
          cancelledAt: null,
          completedAt: null,
          scheduledHardDeleteAt: { lte: new Date() },
        },
        orderBy: { id: 'asc' },
        take: this.cleanupPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const request of requests) {
        try {
          await this.lgpdQueue.add(
            LGPD_JOBS.HARD_DELETE_ACCOUNT,
            { requestId: request.id },
            { jobId: `lgpd-hard-delete-${request.id}` },
          );
          enqueued += 1;
          if (request.status === 'failed') {
            await this.prisma.deleteAccountRequest.updateMany({
              where: { id: request.id, status: 'failed', cancelledAt: null, completedAt: null },
              data: { status: 'pending', errorMessage: null },
            });
          }
        } catch (error) {
          this.logger.error(`Failed to recover hard deletion job ${request.id}`, error);
        }
      }
      if (requests.length < this.cleanupPageSize) break;
      cursor = requests.at(-1)?.id;
    }

    return enqueued;
  }

  async enqueuePendingSoftDeletions(): Promise<number> {
    let enqueued = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const requests = await this.prisma.deleteAccountRequest.findMany({
        where: {
          status: { in: ['pending', 'failed'] },
          softDeletedAt: null,
          cancelledAt: null,
          completedAt: null,
        },
        orderBy: { id: 'asc' },
        take: this.cleanupPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const request of requests) {
        try {
          await this.lgpdQueue.add(
            LGPD_JOBS.SOFT_DELETE_ACCOUNT,
            { requestId: request.id },
            { jobId: `lgpd-soft-delete-${request.id}` },
          );
          enqueued += 1;
          if (request.status === 'failed') {
            await this.prisma.deleteAccountRequest.updateMany({
              where: { id: request.id, status: 'failed', softDeletedAt: null, cancelledAt: null, completedAt: null },
              data: { status: 'pending', errorMessage: null },
            });
          }
        } catch (error) {
          this.logger.error(`Failed to recover soft deletion job ${request.id}`, error);
        }
      }
      if (requests.length < this.cleanupPageSize) break;
      cursor = requests.at(-1)?.id;
    }

    return enqueued;
  }

  async reconcileCancelledAccountDeletions(): Promise<number> {
    let reconciled = 0;
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const requests = await this.prisma.deleteAccountRequest.findMany({
        where: {
          status: 'completed',
          cancelledAt: { not: null },
          errorMessage: { not: null },
        },
        orderBy: { id: 'asc' },
        take: this.cleanupPageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      });
      for (const request of requests) {
        try {
          await this.keycloakService.setUserEnabled(request.userId, true);
          await this.keycloakService.updateUserAttributes(
            request.userId,
            {
              accountDeletionRequested: ['false'],
              accountDeletionRequestId: [''],
              accountDeletionScheduledHardDeleteAt: [''],
            },
            { skipValidation: true },
          );
          await this.notifyExternalDeletionBackends('cancel', request);
          await this.prisma.deleteAccountRequest.updateMany({
            where: { id: request.id, status: 'completed', cancelledAt: { not: null }, errorMessage: { not: null } },
            data: {
              servicesNotified: [
                'cancellation.recorded',
                'keycloak.enabled',
                'keycloak.attributes-cleared',
                'external-backends.cancel',
              ],
              errorMessage: null,
            },
          });
          reconciled += 1;
        } catch (error) {
          this.logger.error(`Failed to reconcile cancelled account deletion ${request.id}`, error);
        }
      }
      if (requests.length < this.cleanupPageSize) break;
      cursor = requests.at(-1)?.id;
    }

    return reconciled;
  }

  private async expireStaleActiveRequests(userId?: string): Promise<number> {
    const result = await this.prisma.lgpdRequest.updateMany({
      where: {
        ...(userId ? { userId } : {}),
        status: { in: ['pending', 'processing'] },
        createdAt: { lte: this.getActiveRequestExpirationCutoff() },
      },
      data: {
        status: 'failed',
        errorMessage: LGPD_ACTIVE_REQUEST_EXPIRED_MESSAGE,
      },
    });

    if (result.count > 0) {
      this.logger.warn(`Expired ${result.count} stale active LGPD request(s)${userId ? ` for user ${userId}` : ''}`);
    }

    return result.count;
  }

  private async markActiveRequestExpired(requestId: string): Promise<void> {
    await this.prisma.lgpdRequest.updateMany({
      where: { id: requestId, status: 'processing' },
      data: {
        status: 'failed',
        errorMessage: LGPD_ACTIVE_REQUEST_EXPIRED_MESSAGE,
      },
    });
  }

  private isActiveRequestExpired(request: LgpdRequest): boolean {
    return (
      (request.status === 'pending' || request.status === 'processing') &&
      request.createdAt <= this.getActiveRequestExpirationCutoff()
    );
  }

  private getActiveRequestExpirationCutoff(): Date {
    return new Date(Date.now() - LGPD_ACTIVE_REQUEST_EXPIRATION_MS);
  }

  async requestAccountDeletion(
    userId: string,
    email: string,
    dto: DeleteAccountRequestDto,
  ): Promise<DeleteAccountResponseDto> {
    if (dto.confirmation !== 'DELETE') {
      throw new BadRequestException('Para confirmar a exclusão da conta, digite "DELETE" no campo de confirmação.');
    }

    const existingRequest = await this.prisma.deleteAccountRequest.findFirst({
      where: {
        userId,
        status: { in: ['pending', 'processing'] },
      },
      orderBy: { createdAt: 'desc' },
    });

    if (existingRequest) {
      throw new BadRequestException('Você já tem uma solicitação de exclusão de conta pendente.');
    }

    const scheduledHardDeleteAt = new Date();
    scheduledHardDeleteAt.setFullYear(scheduledHardDeleteAt.getFullYear() + 1);

    const saved = await this.prisma.deleteAccountRequest.create({
      data: {
        userId,
        email,
        reason: dto.reason,
        status: 'pending',
        scheduledHardDeleteAt,
      },
    });

    try {
      const softDeleteJob = await this.lgpdQueue.add(
        LGPD_JOBS.SOFT_DELETE_ACCOUNT,
        { requestId: saved.id },
        { jobId: `lgpd-soft-delete-${saved.id}` },
      );

      try {
        await this.lgpdQueue.add(
          LGPD_JOBS.HARD_DELETE_ACCOUNT,
          { requestId: saved.id },
          {
            delay: scheduledHardDeleteAt.getTime() - Date.now(),
            jobId: `lgpd-hard-delete-${saved.id}`,
          },
        );
      } catch (error) {
        try {
          await softDeleteJob.remove();
        } catch (removeError) {
          this.logger.error(`Failed to remove soft deletion job for request ${saved.id}`, removeError);
        }
        throw error;
      }
    } catch (error) {
      this.logger.error(`Failed to enqueue account deletion request ${saved.id}`, error);
      await this.prisma.deleteAccountRequest.update({
        where: { id: saved.id },
        data: {
          status: 'failed',
          errorMessage: this.serializeFailureDetails('lgpdQueue.add.account-deletion', error),
        },
      });
      throw new InternalServerErrorException('Não foi possível enfileirar a solicitação de exclusão de conta.');
    }

    return {
      message:
        'Solicitação de exclusão de conta iniciada com sucesso. Seus dados ficarão retidos por 1 ano antes da exclusão definitiva.',
      requestedAt: saved.createdAt,
      servicesNotified: ['keycloak', 'user-service', 'application-data'],
      scheduledHardDeleteAt,
    };
  }

  private async claimDeleteAccountRequest(
    requestId: string,
    options: { requireSoftDeletionPending?: boolean } = {},
  ): Promise<DeleteAccountRequest | null> {
    const staleBefore = new Date(Date.now() - this.operationLeaseMs);
    const claimed = await this.prisma.deleteAccountRequest.updateMany({
      where: {
        id: requestId,
        cancelledAt: null,
        completedAt: null,
        ...(options.requireSoftDeletionPending ? { softDeletedAt: null } : {}),
        OR: [{ status: 'pending' }, { status: 'processing', updatedAt: { lt: staleBefore } }],
      },
      data: { status: 'processing', errorMessage: null },
    });

    if (claimed.count === 0) {
      return null;
    }

    return this.prisma.deleteAccountRequest.findUnique({ where: { id: requestId } });
  }

  async processAccountSoftDeletion(requestId: string): Promise<void> {
    const request = await this.claimDeleteAccountRequest(requestId, { requireSoftDeletionPending: true });

    if (!request) {
      this.logger.warn(`Delete account request ${requestId} not found`);
      return;
    }

    const notifiedServices: string[] = [];
    const failures: AccountDeletionFailure[] = [];
    let externalScheduleAttempted = false;

    try {
      await this.keycloakService.setUserEnabled(request.userId, false);
      notifiedServices.push('keycloak.setUserEnabled');

      await this.keycloakService.updateUserAttributes(
        request.userId,
        {
          accountDeletionRequested: ['true'],
          accountDeletionRequestId: [request.id],
          accountDeletionScheduledHardDeleteAt: [
            (request.scheduledHardDeleteAt || new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)).toISOString(),
          ],
        },
        { skipValidation: true },
      );
      notifiedServices.push('keycloak.updateUserAttributes');

      externalScheduleAttempted = true;
      await this.notifyExternalDeletionBackends('schedule', request);
      notifiedServices.push('external-backends.schedule');

      const finalized = await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, status: 'processing' },
        data: {
          status: 'pending',
          softDeletedAt: new Date(),
          servicesNotified: notifiedServices,
          errorMessage: null,
        },
      });
      if (finalized.count === 0) {
        throw new Error(`Account deletion request ${requestId} changed before soft deletion was finalized`);
      }

      this.logger.debug(
        `Account soft deletion completed for user ${request.userId}. Services notified: ${notifiedServices.join(', ')}`,
      );
    } catch (error) {
      failures.push(this.toAccountDeletionFailure('soft-deletion', 'apply', error));
      failures.push(...(await this.compensateSoftDeletion(request, notifiedServices, externalScheduleAttempted)));
      await this.markAccountDeletionFailed(
        requestId,
        notifiedServices,
        failures,
        ['keycloak.setUserEnabled', 'keycloak.updateUserAttributes', 'external-backends.schedule'].filter(
          (service) => !notifiedServices.includes(service),
        ),
      );
    }
  }

  private async compensateSoftDeletion(
    request: DeleteAccountRequest,
    notifiedServices: string[],
    externalScheduleAttempted: boolean,
  ): Promise<AccountDeletionFailure[]> {
    const failures: AccountDeletionFailure[] = [];

    if (externalScheduleAttempted) {
      try {
        await this.notifyExternalDeletionBackends('cancel', request);
        notifiedServices.push('external-backends.cancel');
      } catch (error) {
        failures.push(this.toAccountDeletionFailure('external-backends', 'cancel', error));
      }
    }

    if (notifiedServices.includes('keycloak.updateUserAttributes')) {
      try {
        await this.keycloakService.updateUserAttributes(
          request.userId,
          {
            accountDeletionRequested: ['false'],
            accountDeletionRequestId: [''],
            accountDeletionScheduledHardDeleteAt: [''],
          },
          { skipValidation: true },
        );
        notifiedServices.push('keycloak.updateUserAttributes.compensated');
      } catch (error) {
        failures.push(this.toAccountDeletionFailure('keycloak', 'clearDeletionAttributes', error));
      }
    }

    if (notifiedServices.includes('keycloak.setUserEnabled')) {
      try {
        await this.keycloakService.setUserEnabled(request.userId, true);
        notifiedServices.push('keycloak.setUserEnabled.compensated');
      } catch (error) {
        failures.push(this.toAccountDeletionFailure('keycloak', 'setUserEnabled.compensate', error));
      }
    }

    return failures;
  }

  async processAccountHardDeletion(requestId: string): Promise<void> {
    const request = await this.claimDeleteAccountRequest(requestId);

    if (!request || request.cancelledAt || request.status === 'completed') {
      return;
    }

    try {
      const notifiedServices: string[] = [];
      const failures: AccountDeletionFailure[] = [];
      const hardDeletionServices = [
        'external-backends.delete',
        'application-data.deleteUserApplicationData',
        'user-service.deleteUserData',
        'keycloak.deleteUser',
      ];

      try {
        await this.notifyExternalDeletionBackends('delete', request);
        notifiedServices.push('external-backends.delete');
      } catch (error) {
        this.logger.error('Error notifying external hard deletion', error);
        failures.push(this.toAccountDeletionFailure('external-backends', 'delete', error));
      }

      try {
        await this.deleteUserApplicationData(request.userId, request.id);
        notifiedServices.push('application-data.deleteUserApplicationData');
      } catch (error) {
        this.logger.error('Error deleting application data', error);
        failures.push(this.toAccountDeletionFailure('application-data', 'deleteUserApplicationData', error));
      }

      if (failures.some((failure) => failure.service === 'application-data')) {
        await this.prisma.deleteAccountRequest.updateMany({
          where: { id: requestId, status: 'processing' },
          data: {
            status: 'failed',
            servicesNotified: notifiedServices,
            errorMessage: this.serializeAccountDeletionFailures(
              failures,
              hardDeletionServices.filter((service) => !notifiedServices.includes(service)),
            ),
          },
        });
        return;
      }

      try {
        await this.userService.deleteUserData(request.userId);
        notifiedServices.push('user-service.deleteUserData');
      } catch (error) {
        this.logger.error('Error deleting user data from user service', error);
        failures.push(this.toAccountDeletionFailure('user-service', 'deleteUserData', error));
      }

      try {
        await this.keycloakService.deleteUser(request.userId);
        notifiedServices.push('keycloak.deleteUser');
      } catch (error) {
        this.logger.error('Error deleting user from Keycloak', error);
        failures.push(this.toAccountDeletionFailure('keycloak', 'deleteUser', error));
      }

      if (failures.length > 0) {
        await this.prisma.deleteAccountRequest.updateMany({
          where: { id: requestId, status: 'processing' },
          data: {
            status: 'failed',
            servicesNotified: notifiedServices,
            errorMessage: this.serializeAccountDeletionFailures(
              failures,
              hardDeletionServices.filter((service) => !notifiedServices.includes(service)),
            ),
          },
        });
        return;
      }

      const finalized = await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, status: 'processing' },
        data: {
          status: 'completed',
          completedAt: new Date(),
          servicesNotified: notifiedServices,
          errorMessage: null,
          userId: `deleted:${request.id}`,
          email: `deleted-${request.id}@deleted.local`,
          reason: null,
        },
      });
      if (finalized.count === 0) {
        throw new Error(`Account deletion request ${requestId} changed before hard deletion was finalized`);
      }
    } catch (error) {
      this.logger.error('Error processing account hard deletion', error);
      await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, status: 'processing' },
        data: {
          status: 'failed',
          servicesNotified: [],
          errorMessage: this.serializeFailureDetails('processAccountHardDeletion', error),
        },
      });
    }
  }

  private async deleteUserApplicationData(userId: string, currentDeleteRequestId: string): Promise<void> {
    const [lgpdRequests, studentDocuments] = await Promise.all([
      this.prisma.lgpdRequest.findMany({
        where: { userId },
        select: { id: true, s3Key: true, filePath: true },
      }),
      this.prisma.studentVerificationDocument.findMany({
        where: { userId },
        select: { id: true, s3Key: true, filePath: true },
      }),
    ]);

    const fileDeletionFailures: string[] = [];

    for (const request of lgpdRequests) {
      if (request.s3Key) {
        try {
          await this.s3Service.deleteFile(request.s3Key);
          this.logger.debug(`Deleted LGPD file from S3: ${request.s3Key}`);
        } catch (error) {
          this.logger.error(`Error deleting S3 file ${request.s3Key}`, error);
          fileDeletionFailures.push(`lgpd:${request.id}:${this.getErrorMessage(error)}`);
        }
      }

      if (request.filePath) {
        this.logger.debug(`Legacy file path found during deletion: ${request.filePath}`);
      }
    }

    for (const document of studentDocuments) {
      if (document.s3Key) {
        try {
          await this.s3Service.deleteFile(document.s3Key);
          this.logger.debug(`Deleted student verification file from S3: ${document.s3Key}`);
        } catch (error) {
          this.logger.error(`Error deleting S3 file ${document.s3Key}`, error);
          fileDeletionFailures.push(`student-verification:${document.id}:${this.getErrorMessage(error)}`);
        }
      }

      if (document.filePath) {
        this.logger.debug(`Legacy file path found during deletion: ${document.filePath}`);
      }
    }

    if (fileDeletionFailures.length > 0) {
      this.logger.warn(
        `Failed to delete ${fileDeletionFailures.length} S3 file(s): ${fileDeletionFailures.join('; ')}`,
      );
      // Keep every source row and its object key. The hard-deletion request is marked failed by
      // the caller, and the preserved references make the failed storage obligations retryable.
      throw new Error(`Mandatory storage deletion failed: ${fileDeletionFailures.join('; ')}`);
    }

    await this.prisma.$transaction(async (tx) => {
      const mergeRequestUserFilter = {
        OR: [
          { requesterUserId: userId },
          { candidateUserId: userId },
          { primaryUserId: userId },
          { secondaryUserId: userId },
        ],
      };
      const mergeRequestIds = await tx.accountMergeRequest.findMany({
        where: mergeRequestUserFilter,
        select: { id: true },
      });

      await tx.accountMergeExternalNotification.deleteMany({
        where: {
          OR: [
            { oldUserId: userId },
            { newUserId: userId },
            { mergeRequestId: { in: mergeRequestIds.map(({ id }) => id) } },
          ],
        },
      });
      await tx.accountMergeRequest.deleteMany({
        where: mergeRequestUserFilter,
      });
      await tx.studentVerificationLog.deleteMany({ where: { userId } });
      await tx.studentVerificationDocument.deleteMany({ where: { userId } });
      await tx.privacySetting.deleteMany({ where: { userId } });
      await tx.lgpdRequest.deleteMany({ where: { userId } });
      await tx.discordLink.deleteMany({ where: { userId } });
      await tx.user.deleteMany({ where: { keycloakId: userId } });
      await tx.deleteAccountRequest.deleteMany({
        where: {
          userId,
          id: { not: currentDeleteRequestId },
        },
      });
    });
  }

  async getPendingAccountDeletionRequests(): Promise<AdminDeleteAccountRequestDto[]> {
    const requests = await this.prisma.deleteAccountRequest.findMany({
      where: {
        status: { in: ['pending', 'processing', 'failed'] },
        cancelledAt: null,
        completedAt: null,
      },
      orderBy: { createdAt: 'desc' },
    });

    return requests.map((request) => this.toAdminDeleteAccountRequestDto(request));
  }

  async undoAccountDeletionRequest(requestId: string): Promise<AdminDeleteAccountRequestDto> {
    const request = await this.prisma.deleteAccountRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.completedAt || request.cancelledAt) {
      throw new NotFoundException('Solicitação de exclusão não encontrada');
    }

    // Record cancellation before touching any external system. A deletion worker can only claim
    // pending rows, so a successful claim here prevents it from starting afterward.
    const cancellationTime = new Date();
    const claimed = await this.prisma.deleteAccountRequest.updateMany({
      where: {
        id: requestId,
        status: { in: ['pending', 'failed'] },
        cancelledAt: null,
        completedAt: null,
      },
      data: {
        status: 'completed',
        cancelledAt: cancellationTime,
        completedAt: cancellationTime,
        servicesNotified: ['cancellation.recorded'],
      },
    });

    if (claimed.count === 0) {
      throw new BadRequestException('A solicitação já está sendo processada ou foi finalizada.');
    }

    try {
      await this.keycloakService.setUserEnabled(request.userId, true);
      await this.keycloakService.updateUserAttributes(
        request.userId,
        {
          accountDeletionRequested: ['false'],
          accountDeletionRequestId: [''],
          accountDeletionScheduledHardDeleteAt: [''],
        },
        { skipValidation: true },
      );
      await this.notifyExternalDeletionBackends('cancel', request);
      await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, status: 'completed', cancelledAt: cancellationTime },
        data: {
          servicesNotified: [
            'cancellation.recorded',
            'keycloak.enabled',
            'keycloak.attributes-cleared',
            'external-backends.cancel',
          ],
          errorMessage: null,
        },
      });
    } catch (error) {
      // Keep the terminal local cancellation and retain a durable reconciliation error. No worker
      // can claim this row, so a later repair process can safely retry the external cancellation.
      await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, status: 'completed', cancelledAt: cancellationTime },
        data: {
          errorMessage: this.serializeFailureDetails('undoAccountDeletionRequest.reconcile', error),
        },
      });
      throw error;
    }

    const updated = await this.prisma.deleteAccountRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    return this.toAdminDeleteAccountRequestDto(updated);
  }

  async deleteAccountNow(requestId: string): Promise<AdminDeleteAccountRequestDto> {
    const request = await this.prisma.deleteAccountRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.completedAt || request.cancelledAt) {
      throw new NotFoundException('Solicitação de exclusão não encontrada');
    }

    const scheduledHardDeleteAt = new Date();
    const scheduled = await this.prisma.deleteAccountRequest.updateMany({
      where: { id: requestId, cancelledAt: null, completedAt: null },
      data: { scheduledHardDeleteAt },
    });
    if (scheduled.count === 0) {
      throw new BadRequestException('A solicitação já está sendo processada ou foi finalizada.');
    }

    try {
      await this.lgpdQueue.add(
        LGPD_JOBS.HARD_DELETE_ACCOUNT,
        { requestId },
        { jobId: `lgpd-hard-delete-${requestId}` },
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue immediate hard deletion request ${requestId}`, error);
      await this.prisma.deleteAccountRequest.updateMany({
        where: { id: requestId, cancelledAt: null, completedAt: null },
        data: {
          status: 'failed',
          errorMessage: this.serializeFailureDetails('lgpdQueue.add.hard-delete-now', error),
        },
      });
      throw new InternalServerErrorException('Não foi possível enfileirar a exclusão imediata da conta.');
    }

    const updated = await this.prisma.deleteAccountRequest.findUniqueOrThrow({
      where: { id: requestId },
    });

    return this.toAdminDeleteAccountRequestDto(updated);
  }

  private async notifyExternalDeletionBackends(
    action: 'schedule' | 'cancel' | 'delete',
    request: DeleteAccountRequest,
  ): Promise<void> {
    const backends = this.getExternalDeletionBackends();

    await Promise.all(
      backends.map(async (backend) => {
        if (!(backend.actions as string[]).includes(action)) return;
        const payload = {
          requestId: request.id,
          userId: request.userId,
          email: request.email,
        };
        try {
          if (action === 'schedule') {
            await this.eventManagerGrpc.scheduleLgpdDeletion(backend.target, backend.audience, payload);
          } else if (action === 'cancel') {
            await this.eventManagerGrpc.cancelLgpdDeletion(backend.target, backend.audience, payload);
          } else if (action === 'delete') {
            await this.eventManagerGrpc.deleteLgpdData(backend.target, backend.audience, payload);
          }
        } catch (error) {
          if (this.isTimeoutError(error)) {
            throw new Error(
              `${backend.name} timed out after ${this.externalRequestTimeoutMs}ms while handling account-deletion.${action}`,
            );
          }
          throw error;
        }
      }),
    );
  }

  private async markAccountDeletionFailed(
    requestId: string,
    notifiedServices: string[],
    failures: AccountDeletionFailure[],
    remainingServices: string[],
  ): Promise<void> {
    this.logger.error(
      `Account deletion request ${requestId} failed during ${failures.map((failure) => failure.operation).join(', ')}`,
      failures,
    );

    await this.prisma.deleteAccountRequest.updateMany({
      where: { id: requestId, status: 'processing' },
      data: {
        status: 'failed',
        servicesNotified: notifiedServices,
        errorMessage: this.serializeAccountDeletionFailures(failures, remainingServices),
      },
    });
  }

  private toAccountDeletionFailure(service: string, operation: string, error: unknown): AccountDeletionFailure {
    return {
      service,
      operation,
      message: this.getErrorMessage(error),
    };
  }

  private serializeAccountDeletionFailures(failures: AccountDeletionFailure[], remainingServices: string[]): string {
    return JSON.stringify({
      failures,
      remainingServices,
      partialState: failures.some((failure) => failure.operation.includes('compensate'))
        ? 'partially_disabled'
        : undefined,
      failedAt: new Date().toISOString(),
    });
  }

  private serializeFailureDetails(operation: string, error: unknown): string {
    return JSON.stringify({
      operation,
      message: this.getErrorMessage(error),
      failedAt: new Date().toISOString(),
    });
  }

  private getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : 'Unknown error';
  }

  private isTimeoutError(error: unknown): boolean {
    return (
      error instanceof Error &&
      (error.name === 'TimeoutError' ||
        error.name === 'AbortError' ||
        ('code' in error && error.code === status.DEADLINE_EXCEEDED))
    );
  }

  private getExternalDeletionBackends(): {
    name: string;
    target: string;
    actions: ('schedule' | 'cancel' | 'delete')[];
    audience?: string;
  }[] {
    const raw = process.env.LGPD_DELETION_GRPC_BACKENDS;
    if (!raw) {
      if (process.env.NODE_ENV === 'production' && process.env.LGPD_DELETION_ALLOW_NO_BACKENDS !== 'true') {
        throw new Error(
          'LGPD_DELETION_GRPC_BACKENDS is required in production; set LGPD_DELETION_ALLOW_NO_BACKENDS=true to opt out explicitly',
        );
      }
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('LGPD_DELETION_GRPC_BACKENDS must be a JSON array');

      const isValid = parsed.every(
        (
          backend,
        ): backend is {
          name: string;
          target: string;
          actions: ('schedule' | 'cancel' | 'delete')[];
          audience?: string;
        } => {
          if (typeof backend !== 'object' || backend === null) {
            return false;
          }

          const candidate = backend as Record<string, unknown>;
          return (
            typeof candidate['name'] === 'string' &&
            typeof candidate['target'] === 'string' &&
            Array.isArray(candidate['actions']) &&
            candidate['actions'].every((item) => ['schedule', 'cancel', 'delete'].includes(String(item)))
          );
        },
      );
      if (!isValid) {
        throw new Error('LGPD_DELETION_GRPC_BACKENDS contains an invalid backend entry');
      }
      const backends = parsed as {
        name: string;
        target: string;
        actions: ('schedule' | 'cancel' | 'delete')[];
        audience?: string;
      }[];
      if (new Set(backends.map((backend) => backend.name)).size !== backends.length) {
        throw new Error('LGPD_DELETION_GRPC_BACKENDS contains duplicate backend names');
      }
      return backends;
    } catch (error) {
      this.logger.error('Invalid LGPD_DELETION_GRPC_BACKENDS configuration', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private getExternalLgpdBackends(): {
    name: string;
    target: string;
    audience?: string;
    category?: string;
  }[] {
    const raw = process.env.LGPD_GRPC_BACKENDS;
    if (!raw) {
      if (process.env.NODE_ENV === 'production' && process.env.LGPD_ALLOW_NO_BACKENDS !== 'true') {
        throw new Error(
          'LGPD_GRPC_BACKENDS is required in production; set LGPD_ALLOW_NO_BACKENDS=true to opt out explicitly',
        );
      }
      return [];
    }

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) throw new Error('LGPD_GRPC_BACKENDS must be a JSON array');

      const isValid = parsed.every(
        (
          backend,
        ): backend is {
          name: string;
          target: string;
          audience?: string;
          category?: string;
        } => {
          if (typeof backend !== 'object' || backend === null) {
            return false;
          }

          const candidate = backend as Record<string, unknown>;
          return typeof candidate['name'] === 'string' && typeof candidate['target'] === 'string';
        },
      );
      if (!isValid) {
        throw new Error('LGPD_GRPC_BACKENDS contains an invalid backend entry');
      }
      const backends = (
        parsed as {
          name: string;
          target: string;
          audience?: string;
          category?: string;
        }[]
      ).map((backend) => ({
        name: backend.name,
        target: backend.target,
        audience: backend.audience,
        category: backend.category,
      }));
      if (new Set(backends.map((backend) => backend.name)).size !== backends.length) {
        throw new Error('LGPD_GRPC_BACKENDS contains duplicate backend names');
      }
      return backends;
    } catch (error) {
      this.logger.error('Invalid LGPD_GRPC_BACKENDS configuration', {
        errorType: error instanceof Error ? error.name : 'UnknownError',
      });
      throw error;
    }
  }

  private normalizeCategoryName(name: string): string {
    return name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
  }

  private toAdminDeleteAccountRequestDto(request: DeleteAccountRequest): AdminDeleteAccountRequestDto {
    return {
      id: request.id,
      userId: request.userId,
      email: request.email,
      status: request.status,
      reason: request.reason ?? undefined,
      softDeletedAt: request.softDeletedAt ?? undefined,
      scheduledHardDeleteAt: request.scheduledHardDeleteAt ?? undefined,
      completedAt: request.completedAt ?? undefined,
      errorMessage: request.errorMessage ?? undefined,
      createdAt: request.createdAt,
    };
  }

  private toDto(request: LgpdRequest): LgpdRequestDto {
    return {
      id: request.id,
      userId: request.userId,
      email: request.email,
      status: request.status,
      fileName: request.fileName ?? undefined,
      fileSize: request.fileSize ?? undefined,
      errorMessage: request.errorMessage ?? undefined,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      downloadedAt: request.downloadedAt ?? undefined,
      expiresAt: request.expiresAt ?? undefined,
    };
  }

  private toListDto(request: LgpdRequest): LgpdRequestListDto {
    return {
      id: request.id,
      status: request.status,
      createdAt: request.createdAt,
      downloadedAt: request.downloadedAt ?? undefined,
      expiresAt: request.expiresAt ?? undefined,
      fileName: request.fileName ?? undefined,
      fileSize: request.fileSize ?? undefined,
    };
  }

  private validateUserOwnership(requestUserId: string, sessionUserId: string): void {
    if (requestUserId !== sessionUserId) {
      throw new Error('Acesso negado: usuário não pode acessar dados de outro usuário');
    }
  }
}
