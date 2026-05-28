import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UserProfile } from '../interfaces/auth.interface';
import { JwtService } from '../jwt/jwt.service';

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
  private readonly profileUpdateUrl: string;
  private readonly audience?: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly jwtService: JwtService,
  ) {
    this.profileUpdateUrl =
      this.configService.get<string>('EVENT_MANAGER_PROFILE_UPDATE_URL') ??
      `${(
        this.configService.get<string>('EVENT_MANAGER_API_URL') ??
        'https://eventos.cacic.dev.br/api'
      ).replace(/\/+$/, '')}/internal/account-profile/updated`;
    this.audience = this.configService.get<string>(
      'EVENT_MANAGER_M2M_AUDIENCE',
    );
  }

  async notifyProfileUpdated(profile: UserProfile): Promise<void> {
    const payload = this.toPayload(profile);
    const token = await this.jwtService.getClientCredentialsToken({
      audience: this.audience,
    });

    const response = await fetch(this.profileUpdateUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30_000),
    });

    if (!response.ok) {
      const body = await response.text();
      this.logger.warn('Event Manager profile sync failed', {
        status: response.status,
        statusText: response.statusText,
        userId: profile.keycloakId,
        body,
      });
      return;
    }

    this.logger.debug('Event Manager profile sync delivered', {
      userId: profile.keycloakId,
    });
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
