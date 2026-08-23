import { Module, Global } from '@nestjs/common';
import { CsrfService } from './csrf.service';
import { CsrfGuard } from './csrf.guard';
import { CsrfController } from './csrf.controller';
import { APP_GUARD } from '@nestjs/core';

/**
 * Global CSRF protection module
 * Makes CSRF service and guard available across all modules without explicit imports
 */
@Global()
@Module({
  controllers: [CsrfController],
  providers: [
    CsrfService,
    CsrfGuard,
    {
      provide: APP_GUARD,
      useExisting: CsrfGuard,
    },
  ],
  exports: [CsrfService, CsrfGuard],
})
export class CsrfModule {}
