import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAccountBackendHttpApp, getAccountBackendGlobalPrefix } from './bootstrap/account-backend-http-app';
import { createAppConfig } from './config/app.config';
import { startAccountManagerGrpcServer } from './grpc/account-manager-grpc.server';

async function bootstrap() {
  const app = await createAccountBackendHttpApp();
  const bootstrapLogger = new Logger('Bootstrap');
  const appConfig = createAppConfig(app.get(ConfigService));

  await startAccountManagerGrpcServer(app);
  await app.listen(appConfig.port);
  bootstrapLogger.log(`Application is running on: ${appConfig.backendUrl}/${getAccountBackendGlobalPrefix()}`);
}
const bootstrapFailureLogger = new Logger('Bootstrap');

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  bootstrapFailureLogger.fatal(`Failed to bootstrap application: ${message}`, stack);
  process.exit(1);
});
