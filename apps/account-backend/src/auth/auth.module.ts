import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';
import { AuthController } from './auth.controller';
import { AccountLinkingController } from './account-linking/account-linking.controller';
import { AccountLinkingService } from './account-linking/account-linking.service';
import { AccountLinkingProcessor } from './account-linking/account-linking.processor';
import { ACCOUNT_MERGE_QUEUE } from './account-linking/account-linking.queue';
import { KeycloakService } from './services/keycloak.service';
import { UserService } from './services/user.service';
import { EventManagerProfileSyncService } from './services/event-manager-profile-sync.service';
import { FileValidationService } from './services/file-validation.service';
import { RateLimitService } from './services/rate-limit.service';
import { AuthGuard } from './guards/auth.guard';
import { CurrentUserGuard } from './guards/current-user.guard';
import { KeycloakRoleGuard } from './guards/keycloak-role.guard';
import { UniversityValidationGuard } from './guards/university-validation.guard';
import { CsrfModule } from './csrf/csrf.module';
import { JwtModule } from './jwt/jwt.module';

@Module({
  imports: [
    ConfigModule,
    CsrfModule,
    JwtModule,
    BullModule.registerQueue({ name: ACCOUNT_MERGE_QUEUE }),
  ],
  controllers: [AuthController, AccountLinkingController],
  providers: [
    KeycloakService,
    UserService,
    EventManagerProfileSyncService,
    AccountLinkingService,
    AccountLinkingProcessor,
    FileValidationService,
    RateLimitService,
    AuthGuard,
    CurrentUserGuard,
    KeycloakRoleGuard,
    UniversityValidationGuard,
  ],
  exports: [
    UserService,
    KeycloakService,
    EventManagerProfileSyncService,
    AccountLinkingService,
    FileValidationService,
    RateLimitService,
    AuthGuard,
    CurrentUserGuard,
    KeycloakRoleGuard,
    UniversityValidationGuard,
    CsrfModule,
  ],
})
export class AuthModule {}
