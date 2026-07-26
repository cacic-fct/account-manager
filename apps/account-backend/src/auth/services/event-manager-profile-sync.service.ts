import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserProfile } from '../interfaces/auth.interface';
import { EventManagerGrpcClient } from '../../grpc/event-manager-grpc.client';

type EventManagerProfileUpdatePayload = {
  userId: string;
  email?: string;
  name?: string;
  fullname?: string;
  phone?: string;
  identityDocument?: string;
  academicId?: string;
  unespRole?: string[];
  isOnboarded?: boolean;
};

@Injectable()
export class EventManagerProfileSyncService {
  private readonly logger = new Logger(EventManagerProfileSyncService.name);
  private readonly grpcTarget: string;
  private readonly audience?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly eventManager: EventManagerGrpcClient,
  ) {
    const configuredTarget = this.configService.get<string>('EVENT_MANAGER_GRPC_URL')?.trim();
    this.grpcTarget = configuredTarget || 'localhost:50051';
    if (!configuredTarget) {
      this.logger.warn('EVENT_MANAGER_GRPC_URL is not configured; using the development fallback localhost:50051.');
    }
    this.audience = this.configService.get<string>('EVENT_MANAGER_M2M_AUDIENCE');
  }

  async notifyProfileUpdated(profile: UserProfile): Promise<void> {
    const payload = this.toPayload(profile);
    try {
      await this.eventManager.notifyProfileUpdated(this.grpcTarget, this.audience, payload);
      this.logger.debug('Event Manager profile sync delivered', {
        userId: profile.keycloakId,
      });
    } catch (error) {
      this.logger.warn('Event Manager profile sync failed', {
        userId: profile.keycloakId,
        error: error instanceof Error ? error.message : 'Unknown gRPC error',
      });
    }
  }

  private toPayload(profile: UserProfile): EventManagerProfileUpdatePayload {
    return {
      userId: profile.keycloakId,
      email: profile.email,
      name: profile.displayName,
      fullname: profile.fullname,
      phone: profile.phone,
      identityDocument: profile.identityDocument,
      academicId: profile.enrollmentNumber,
      unespRole: profile.unespRole ? [profile.unespRole] : [],
      isOnboarded: profile.isOnboarded,
    };
  }
}
