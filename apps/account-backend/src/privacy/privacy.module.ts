import { Module } from '@nestjs/common';
import { PrivacyService } from './privacy.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyApiController } from './privacy-api.controller';
import { PrivacyDirectiveService } from './services/privacy-directive.service';
import { PrivacyDirectiveController } from './controllers/privacy-directive.controller';
import { PrivacyDirectiveMiddleware } from './middleware/privacy-directive.middleware';
import { JwtModule } from '../auth/jwt/jwt.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [JwtModule, AuthModule],
  controllers: [
    PrivacyController,
    PrivacyApiController,
    PrivacyDirectiveController,
  ],
  providers: [
    PrivacyService,
    PrivacyDirectiveService,
    PrivacyDirectiveMiddleware,
  ],
  exports: [
    PrivacyService,
    PrivacyDirectiveService,
    PrivacyDirectiveMiddleware,
  ],
})
export class PrivacyModule {}
