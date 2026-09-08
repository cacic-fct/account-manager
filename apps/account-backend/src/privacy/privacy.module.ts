import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrivacyService } from './privacy.service';
import { PrivacyController } from './privacy.controller';
import { PrivacyDirectiveService } from './services/privacy-directive.service';
import { PrivacyDirectiveMiddleware } from './middleware/privacy-directive.middleware';
import { TrackingController } from './tracking.controller';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [ConfigModule, AuthModule],
  controllers: [PrivacyController, TrackingController],
  providers: [PrivacyService, PrivacyDirectiveService, PrivacyDirectiveMiddleware],
  exports: [PrivacyService, PrivacyDirectiveService, PrivacyDirectiveMiddleware],
})
export class PrivacyModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(PrivacyDirectiveMiddleware).forRoutes('{*path}');
  }
}
