import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { LgpdModule } from '../lgpd/lgpd.module';
import { StudentVerificationModule } from '../student-verification/student-verification.module';
import { BackgroundJobsProcessor } from './background-jobs.processor';
import { BACKGROUND_JOBS_QUEUE } from './background-jobs.queue';
import { BackgroundJobsService } from './background-jobs.service';

@Module({
  imports: [
    AuthModule,
    LgpdModule,
    StudentVerificationModule,
    BullModule.registerQueue({ name: BACKGROUND_JOBS_QUEUE }),
  ],
  providers: [BackgroundJobsService, BackgroundJobsProcessor],
})
export class BackgroundJobsModule {}
