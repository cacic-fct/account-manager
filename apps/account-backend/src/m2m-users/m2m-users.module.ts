import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { M2MUsersService } from './m2m-users.service';

@Module({
  imports: [AuthModule],
  providers: [M2MUsersService],
})
export class M2MUsersModule {}
