import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createAccountBackendHttpApp, getAccountBackendGlobalPrefix } from './bootstrap/account-backend-http-app';
import { createAppConfig } from './config/app.config';
import { startAccountManagerGrpcServer } from './grpc/account-manager-grpc.server';

async function bootstrap() {
  const app = await createAccountBackendHttpApp();
  const bootstrapLogger = new Logger('Bootstrap');
  const appConfig = createAppConfig(app.get(ConfigService));

  const grpcServer = await startAccountManagerGrpcServer(app);
  registerGracefulShutdown(app, grpcServer, bootstrapLogger);
  await app.listen(appConfig.port);
  bootstrapLogger.log(`Application is running on: ${appConfig.backendUrl}/${getAccountBackendGlobalPrefix()}`);
}

function registerGracefulShutdown(
  app: Awaited<ReturnType<typeof createAccountBackendHttpApp>>,
  grpcServer: import('@grpc/grpc-js').Server,
  logger: Logger,
): void {
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}; shutting down HTTP and gRPC servers.`);
    const [httpShutdown] = await Promise.allSettled([app.close()]);
    if (httpShutdown.status === 'rejected') {
      logger.error('HTTP graceful shutdown failed', httpShutdown.reason);
      return;
    }

    const timeout = setTimeout(() => grpcServer.forceShutdown(), 10_000);
    try {
      await new Promise<void>((resolve) =>
        grpcServer.tryShutdown((error) => {
          if (error) logger.warn(`gRPC graceful shutdown failed: ${error.message}`);
          resolve();
        }),
      );
    } finally {
      clearTimeout(timeout);
    }
  };
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => void shutdown(signal));
  }
}
const bootstrapFailureLogger = new Logger('Bootstrap');

void bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;

  bootstrapFailureLogger.fatal(`Failed to bootstrap application: ${message}`, stack);
  process.exit(1);
});
