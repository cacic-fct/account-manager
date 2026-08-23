import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  closeAccountBackendHttpApp,
  createAccountBackendHttpApp,
  getAccountBackendGlobalPrefix,
} from './bootstrap/account-backend-http-app';
import { createAppConfig } from './config/app.config';
import { setAccountManagerGrpcReady, startAccountManagerGrpcServer } from './grpc/account-manager-grpc.server';

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
    setAccountManagerGrpcReady(false);
    const grpcShutdown = new Promise<void>((resolve, reject) =>
      grpcServer.tryShutdown((error) => (error ? reject(error) : resolve())),
    );
    const timeout = setTimeout(() => grpcServer.forceShutdown(), 10_000);
    timeout.unref();
    const results = await Promise.allSettled([closeAccountBackendHttpApp(app), grpcShutdown]);
    clearTimeout(timeout);

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('Graceful shutdown step failed', result.reason);
        process.exitCode = 1;
      }
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
  process.exitCode = 1;
});
