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
import { JwtService } from '../auth/jwt/jwt.service';
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

@Injectable()
export class LgpdService {
  private readonly logger = new Logger(LgpdService.name);
  private readonly externalRequestTimeoutMs = 30_000;

  constructor(
    private readonly prisma: PrismaService,
    private keycloakService: KeycloakService,
    private userService: UserService,
    private jwtService: JwtService,
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

      await this.prisma.lgpdRequest.updateMany({
        where: { id, userId },
        data: { downloadedAt: new Date() },
      });

      return {
        stream,
        fileName: request.fileName || 'dados-lgpd.zip',
      };
    } catch {
      throw new NotFoundException('Arquivo não pôde ser baixado do servidor');
    }
  }

  async processRequest(requestId: string): Promise<void> {
    const request = await this.prisma.lgpdRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) return;

    if (this.isActiveRequestExpired(request)) {
      await this.markActiveRequestExpired(requestId);
      return;
    }

    try {
      await this.prisma.lgpdRequest.update({
        where: { id: requestId },
        data: { status: 'processing' },
      });

      const userData = await this.collectUserData(request.userId);

      const { s3Key, fileName, fileSize } = await this.createAndUploadZipFile(request.userId, userData);

      await this.prisma.lgpdRequest.update({
        where: { id: requestId },
        data: {
          status: 'completed',
          s3Key,
          fileName,
          fileSize,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } catch (error) {
      this.logger.error('Error processing LGPD request', error);
      await this.prisma.lgpdRequest.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          errorMessage: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }
  }

  private async collectUserData(userId: string): Promise<Record<string, any>> {
    const data: Record<string, any> = {};

    try {
      const userProfile = await this.userService.findByKeycloakId(userId);
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
      }

      const keycloakAttributes = await this.keycloakService.getUserAttributes(userId);
      if (keycloakAttributes) {
        data.atributos_cacic_sso = keycloakAttributes;
      }

      const userGroups = await this.keycloakService.getUserGroups(userId);
      if (userGroups) {
        data.grupos_cacic_sso = userGroups;
      }

      const basicInfo = await this.keycloakService.getUserBasicInfo(userId);
      if (basicInfo) {
        data.informacoes_basicas_cacic_sso = {
          id: basicInfo.id,
          email: basicInfo.email,
          atributos: basicInfo.attributes,
        };
      }

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
        data.contas_discord_vinculadas = {
          erro: 'Erro ao coletar dados de contas Discord',
          detalhes: error instanceof Error ? error.message : 'Unknown error',
        };
      }

      const externalData = await this.collectExternalData(userId, userProfile?.email || '');
      Object.assign(data, externalData);
    } catch (error) {
      this.logger.error('Error collecting user data', error);
      data.erro_coleta = {
        mensagem: 'Erro ao coletar alguns dados do usuário',
        detalhes: error instanceof Error ? error.message : 'Unknown error',
        data_erro: new Date().toISOString(),
      };
    }

    return data;
  }

  private async collectExternalData(userId: string, email: string): Promise<Record<string, any>> {
    const externalData: Record<string, any> = {};
    const backends = this.getExternalLgpdBackends().filter((backend) => backend.dataUrl);

    await Promise.all(
      backends.map(async (backend) => {
        const category = backend.category || this.normalizeCategoryName(backend.name);

        try {
          const response = await fetch(backend.dataUrl!, {
            method: 'POST',
            headers: await this.externalHeaders(backend),
            body: JSON.stringify({ userId, email }),
            signal: AbortSignal.timeout(this.externalRequestTimeoutMs),
          });

          if (!response.ok) {
            throw new Error(`${response.status} ${response.statusText}`);
          }

          externalData[category] = (await response.json()) as unknown;
        } catch (error) {
          this.logger.error(`Error collecting external LGPD data from ${backend.name}`, error);
          externalData[category] = {
            erro: `Erro ao coletar dados de ${backend.name}`,
            detalhes: error instanceof Error ? error.message : 'Unknown error',
            data_erro: new Date().toISOString(),
          };
        }
      }),
    );

    return externalData;
  }

  private async createAndUploadZipFile(
    userId: string,
    userData: Record<string, any>,
  ): Promise<{ s3Key: string; fileName: string; fileSize: number }> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const fileName = `dados-lgpd-${userId.substring(0, 8)}-${timestamp}.zip`;

    const s3Key = this.s3Service.generateFileKey('lgpd', userId, fileName);

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
    const expiredRequests = await this.prisma.lgpdRequest.findMany({
      where: {
        status: 'completed',
        expiresAt: { lt: now },
      },
    });

    const deletedRequestIds: string[] = [];

    for (const request of expiredRequests) {
      if (request.s3Key) {
        try {
          await this.s3Service.deleteFile(request.s3Key);
          deletedRequestIds.push(request.id);
          this.logger.debug(`Deleted expired LGPD file from S3: ${request.s3Key}`);
        } catch (error) {
          this.logger.error(`Error deleting S3 file ${request.s3Key}`, error);
        }
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
    await this.prisma.lgpdRequest.update({
      where: { id: requestId },
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

  async processAccountSoftDeletion(requestId: string): Promise<void> {
    const request = await this.prisma.deleteAccountRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      this.logger.warn(`Delete account request ${requestId} not found`);
      return;
    }

    try {
      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
        data: { status: 'processing' },
      });

      const notifiedServices: string[] = [];
      const softDeletionServices = [
        'keycloak.setUserEnabled',
        'keycloak.updateUserAttributes',
        'external-backends.schedule',
      ];

      try {
        await this.keycloakService.setUserEnabled(request.userId, false);
        notifiedServices.push('keycloak.setUserEnabled');
      } catch (error) {
        await this.markAccountDeletionFailed(
          requestId,
          notifiedServices,
          [this.toAccountDeletionFailure('keycloak', 'setUserEnabled', error)],
          softDeletionServices.filter(
            (service) => !notifiedServices.includes(service) && service !== 'keycloak.setUserEnabled',
          ),
        );
        return;
      }

      try {
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
      } catch (error) {
        await this.markAccountDeletionFailed(
          requestId,
          notifiedServices,
          [this.toAccountDeletionFailure('keycloak', 'updateUserAttributes', error)],
          softDeletionServices.filter(
            (service) => !notifiedServices.includes(service) && service !== 'keycloak.updateUserAttributes',
          ),
        );
        return;
      }

      try {
        await this.notifyExternalDeletionBackends('schedule', request);
        notifiedServices.push('external-backends.schedule');
      } catch (error) {
        await this.markAccountDeletionFailed(
          requestId,
          notifiedServices,
          [this.toAccountDeletionFailure('external-backends', 'schedule', error)],
          softDeletionServices.filter(
            (service) => !notifiedServices.includes(service) && service !== 'external-backends.schedule',
          ),
        );
        return;
      }

      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
        data: {
          status: 'pending',
          softDeletedAt: new Date(),
          servicesNotified: notifiedServices,
        },
      });

      this.logger.log(
        `Account soft deletion completed for user ${request.userId}. Services notified: ${notifiedServices.join(', ')}`,
      );
    } catch (error) {
      this.logger.error('Error processing account deletion', error);

      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
        data: {
          status: 'failed',
          servicesNotified: [],
          errorMessage: this.serializeFailureDetails('processAccountSoftDeletion', error),
        },
      });
    }
  }

  async processAccountHardDeletion(requestId: string): Promise<void> {
    const request = await this.prisma.deleteAccountRequest.findUnique({
      where: { id: requestId },
    });

    if (!request || request.cancelledAt || request.status === 'completed') {
      return;
    }

    try {
      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
        data: { status: 'processing' },
      });

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
        await this.prisma.deleteAccountRequest.update({
          where: { id: requestId },
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
        await this.prisma.deleteAccountRequest.update({
          where: { id: requestId },
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

      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
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
    } catch (error) {
      this.logger.error('Error processing account hard deletion', error);
      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
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
        this.logger.verbose(`Legacy file path found during deletion: ${request.filePath}`);
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
        this.logger.verbose(`Legacy file path found during deletion: ${document.filePath}`);
      }
    }

    if (fileDeletionFailures.length > 0) {
      this.logger.warn(
        `Failed to delete ${fileDeletionFailures.length} S3 file(s): ${fileDeletionFailures.join('; ')}`,
      );
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

    const updated = await this.prisma.deleteAccountRequest.update({
      where: { id: requestId },
      data: {
        status: 'completed',
        cancelledAt: new Date(),
        completedAt: new Date(),
      },
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

    await this.prisma.deleteAccountRequest.update({
      where: { id: requestId },
      data: { scheduledHardDeleteAt: new Date() },
    });

    try {
      await this.lgpdQueue.add(
        LGPD_JOBS.HARD_DELETE_ACCOUNT,
        { requestId },
        { jobId: `lgpd-hard-delete-now-${requestId}-${Date.now()}` },
      );
    } catch (error) {
      this.logger.error(`Failed to enqueue immediate hard deletion request ${requestId}`, error);
      await this.prisma.deleteAccountRequest.update({
        where: { id: requestId },
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
        const url =
          action === 'cancel' ? backend.cancelUrl : action === 'delete' ? backend.deleteUrl : backend.scheduleUrl;

        if (!url) return;

        let response: Response;
        try {
          response = await fetch(url, {
            method: 'POST',
            headers: await this.externalHeaders(backend),
            body: JSON.stringify({
              event: `account-deletion.${action}`,
              requestId: request.id,
              userId: request.userId,
              email: request.email,
              scheduledHardDeleteAt: request.scheduledHardDeleteAt,
            }),
            signal: AbortSignal.timeout(this.externalRequestTimeoutMs),
          });
        } catch (error) {
          if (this.isTimeoutError(error)) {
            throw new Error(
              `${backend.name} timed out after ${this.externalRequestTimeoutMs}ms while handling account-deletion.${action}`,
            );
          }
          throw error;
        }

        if (!response.ok) {
          throw new Error(`${backend.name} returned ${response.status} ${response.statusText}`);
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

    await this.prisma.deleteAccountRequest.update({
      where: { id: requestId },
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
    return error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError');
  }

  private getExternalDeletionBackends(): {
    name: string;
    scheduleUrl?: string;
    cancelUrl?: string;
    deleteUrl?: string;
    audience?: string;
  }[] {
    const raw = process.env.LGPD_DELETION_EXTERNAL_BACKENDS;
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed.filter(
        (
          backend,
        ): backend is {
          name: string;
          scheduleUrl?: string;
          cancelUrl?: string;
          deleteUrl?: string;
          audience?: string;
        } => {
          if (typeof backend !== 'object' || backend === null) {
            return false;
          }

          const candidate = backend as Record<string, unknown>;
          return typeof candidate['name'] === 'string';
        },
      );
    } catch (error) {
      this.logger.error('Invalid LGPD_DELETION_EXTERNAL_BACKENDS JSON', error);
      return [];
    }
  }

  private getExternalLgpdBackends(): {
    name: string;
    dataUrl?: string;
    audience?: string;
    category?: string;
  }[] {
    const raw = process.env.LGPD_EXTERNAL_BACKENDS || process.env.LGPD_DATA_EXTERNAL_BACKENDS;
    if (!raw) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];

      return parsed
        .filter(
          (
            backend,
          ): backend is {
            name: string;
            dataUrl?: string;
            audience?: string;
            category?: string;
          } => {
            if (typeof backend !== 'object' || backend === null) {
              return false;
            }

            const candidate = backend as Record<string, unknown>;
            return typeof candidate['name'] === 'string';
          },
        )
        .map((backend) => ({
          name: backend.name,
          dataUrl: backend.dataUrl,
          audience: backend.audience,
          category: backend.category,
        }));
    } catch (error) {
      this.logger.error('Invalid LGPD_EXTERNAL_BACKENDS JSON', error);
      return [];
    }
  }

  private async externalHeaders(backend: { audience?: string }): Promise<Record<string, string>> {
    const token = await this.jwtService.getClientCredentialsToken({
      audience: backend.audience,
    });

    return {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    };
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
