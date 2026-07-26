import {
  ChannelCredentials,
  Client,
  type ClientOptions,
  type Metadata,
  type MethodDefinition,
  type ServiceDefinition,
  status,
} from '@grpc/grpc-js';
import { loadPackageDefinition, type GrpcObject } from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

type UnknownMethodDefinition = MethodDefinition<unknown, unknown>;
const TRANSIENT_CODES = new Set([status.UNAVAILABLE, status.DEADLINE_EXCEEDED, status.RESOURCE_EXHAUSTED]);

export function resolveGrpcProtoPath(fileName: string): string {
  const configuredRoot = process.env.CACIC_GRPC_PROTO_ROOT?.trim();
  const candidates = [
    ...(configuredRoot ? [join(configuredRoot, fileName)] : []),
    join(__dirname, 'assets', 'grpc', fileName),
    join(process.cwd(), 'src', 'assets', 'grpc', fileName),
    join(process.cwd(), 'apps', 'account-backend', 'src', 'assets', 'grpc', fileName),
  ];
  const resolved = candidates.find((candidate) => existsSync(candidate));
  if (!resolved) {
    throw new Error(`Could not find gRPC contract ${fileName}.`);
  }
  return resolved;
}

export function loadGrpcServiceDefinition(
  protoPath: string,
  packageSegments: readonly string[],
  serviceName: string,
): ServiceDefinition {
  const definition = loadSync(protoPath, {
    defaults: false,
    enums: String,
    keepCase: false,
    longs: String,
    oneofs: true,
  });
  let current: GrpcObject | undefined = loadPackageDefinition(definition);
  for (const segment of packageSegments) {
    const next: unknown = current?.[segment];
    if (typeof next !== 'object' || next === null) {
      throw new Error(`gRPC package ${packageSegments.join('.')} was not found in ${protoPath}.`);
    }
    current = next as GrpcObject;
  }
  const service = current[serviceName] as { service?: ServiceDefinition } | undefined;
  if (!service?.service) {
    throw new Error(`gRPC service ${serviceName} was not found in ${protoPath}.`);
  }
  return service.service;
}

export class GrpcUnaryClient {
  private readonly client: Client;

  constructor(
    target: string,
    private readonly service: ServiceDefinition,
    options: ClientOptions = {},
  ) {
    this.client = new Client(target, ChannelCredentials.createInsecure(), {
      'grpc.keepalive_time_ms': 60_000,
      'grpc.keepalive_timeout_ms': 10_000,
      'grpc.keepalive_permit_without_calls': 0,
      ...options,
    });
  }

  async call<T>(
    methodName: string,
    request: unknown,
    metadata: Metadata,
    options: { idempotent?: boolean; maxAttempts?: number; timeoutMs?: number } = {},
  ): Promise<T> {
    const method = this.findMethod(methodName);
    const maxAttempts = options.idempotent ? (options.maxAttempts ?? 3) : 1;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const deadline = Date.now() + timeoutMs;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error('gRPC request deadline exceeded.');
        await this.waitForReady(deadline);
        return await this.request<T>(method, request, metadata, deadline);
      } catch (error) {
        lastError = error;
        if (!this.shouldRetry(error, attempt, maxAttempts)) {
          throw error;
        }
        const backoffMs = Math.min(100 * 2 ** (attempt - 1), 1_000);
        const jitteredBackoffMs = Math.round(backoffMs * (0.8 + Math.random() * 0.4));
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw error;
        await new Promise((resolve) => setTimeout(resolve, Math.min(jitteredBackoffMs, remainingMs)));
      }
    }
    throw lastError;
  }

  close(): void {
    this.client.close();
  }

  private findMethod(methodName: string): UnknownMethodDefinition {
    const method = Object.values(this.service).find(
      (candidate) => candidate.originalName === methodName || candidate.path.endsWith(`/${methodName}`),
    );
    if (!method) throw new Error(`Unknown gRPC method ${methodName}.`);
    return method;
  }

  private waitForReady(deadline: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.client.waitForReady(deadline, (error) => (error ? reject(error) : resolve()));
    });
  }

  private request<T>(
    method: UnknownMethodDefinition,
    request: unknown,
    metadata: Metadata,
    deadline: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.client.makeUnaryRequest(
        method.path,
        method.requestSerialize,
        method.responseDeserialize,
        request,
        metadata,
        { deadline },
        (error, response) => (error ? reject(error) : resolve(response as T)),
      );
    });
  }

  private shouldRetry(error: unknown, attempt: number, maxAttempts: number): boolean {
    if (attempt >= maxAttempts || typeof error !== 'object' || error === null) return false;
    if ('code' in error && typeof error.code === 'number') return TRANSIENT_CODES.has(error.code);
    return error instanceof Error && /failed to connect|before the deadline/i.test(error.message);
  }
}
