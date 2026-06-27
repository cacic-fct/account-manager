import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { JwtModule } from '../auth/jwt/jwt.module';
import { M2MUsersApiController } from './m2m-users-api.controller';
import { M2MUsersService } from './m2m-users.service';

@Module({
  imports: [AuthModule, JwtModule],
  controllers: [M2MUsersApiController],
  providers: [M2MUsersService],
})
export class M2MUsersModule {}
