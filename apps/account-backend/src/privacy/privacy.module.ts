import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrivacyService } from './privacy.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyApiController } from './privacy-api.controller';
import { PrivacyDirectiveService } from './services/privacy-directive.service';
import { PrivacyDirectiveController } from './controllers/privacy-directive.controller';
import { PrivacyDirectiveMiddleware } from './middleware/privacy-directive.middleware';
import { TrackingController } from './tracking.controller';
import { JwtModule } from '../auth/jwt/jwt.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, JwtModule, AuthModule],
  controllers: [PrivacyController, PrivacyApiController, PrivacyDirectiveController, TrackingController],
  providers: [PrivacyService, PrivacyDirectiveService, PrivacyDirectiveMiddleware],
  exports: [PrivacyService, PrivacyDirectiveService, PrivacyDirectiveMiddleware],
})
export class PrivacyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PrivacyDirectiveMiddleware).forRoutes('{*path}');
  }
}
