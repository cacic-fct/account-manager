import { Global, Module } from '@nestjs/common';
import { JwtModule } from '../auth/jwt/jwt.module';
import { EventManagerGrpcClient } from './event-manager-grpc.client';

@Global()
@Module({
  imports: [JwtModule],
  providers: [EventManagerGrpcClient],
  exports: [EventManagerGrpcClient],
})
export class GrpcModule {}
