import { Metadata } from '@grpc/grpc-js';
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { JwtService } from '../auth/jwt/jwt.service';
import { GrpcUnaryClient, loadGrpcServiceDefinition, resolveGrpcProtoPath } from './grpc-runtime';

type JsonResponse = { json?: unknown };
type ScoreResponse = { scores?: unknown };

@Injectable()
export class EventManagerGrpcClient implements OnModuleDestroy {
  private readonly logger = new Logger(EventManagerGrpcClient.name);
  private readonly clients = new Map<string, GrpcUnaryClient>();
  private readonly service = loadGrpcServiceDefinition(
    resolveGrpcProtoPath('event-manager-m2m.proto'),
    ['cacic', 'm2m', 'event_manager', 'v1'],
    'EventManagerM2M',
  );

  constructor(private readonly jwt: JwtService) {}

  notifyProfileUpdated(
    target: string,
    audience: string | undefined,
    request: Record<string, unknown>,
  ): Promise<unknown> {
    return this.call(target, audience, 'SyncAccountProfile', request, true);
  }

  async scoreAccounts(
    target: string,
    audience: string | undefined,
    userIds: string[],
    timeoutMs: number,
  ): Promise<Record<string, number>> {
    const response = await this.call<ScoreResponse>(
      target,
      audience,
      'ScoreAccountMerge',
      { userIds },
      true,
      Math.max(Math.floor(timeoutMs / 3), 1_000),
    );
    const scores: Record<string, number> = {};
    if (Array.isArray(response.scores)) {
      for (const item of response.scores) {
        if (isScoreItem(item)) {
          scores[item.userId] = item.score;
        }
      }
    }
    return scores;
  }

  applyAccountMerge(
    target: string,
    audience: string | undefined,
    request: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return this.call(target, audience, 'ApplyAccountMerge', request, true);
  }

  async collectLgpdData(
    target: string,
    audience: string | undefined,
    request: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callJson(target, audience, 'CollectLgpdUserData', request, true);
  }

  async scheduleLgpdDeletion(
    target: string,
    audience: string | undefined,
    request: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callJson(target, audience, 'ScheduleLgpdDeletion', request, true);
  }

  async deleteLgpdData(
    target: string,
    audience: string | undefined,
    request: Record<string, unknown>,
  ): Promise<unknown> {
    return this.callJson(target, audience, 'DeleteLgpdData', request, true);
  }

  onModuleDestroy(): void {
    for (const client of this.clients.values()) client.close();
    this.clients.clear();
  }

  private async callJson(
    target: string,
    audience: string | undefined,
    method: string,
    request: Record<string, unknown>,
    idempotent: boolean,
  ): Promise<unknown> {
    const response = await this.call<JsonResponse>(target, audience, method, request, idempotent);
    if (typeof response.json !== 'string') {
      throw new Error(`Event Manager returned an invalid ${method} response.`);
    }
    return JSON.parse(response.json) as unknown;
  }

  private async call<T = Record<string, unknown>>(
    target: string,
    audience: string | undefined,
    method: string,
    request: Record<string, unknown>,
    idempotent: boolean,
    timeoutMs = 10_000,
  ): Promise<T> {
    const metadata = new Metadata();
    metadata.set('authorization', `Bearer ${await this.jwt.getClientCredentialsToken({ audience })}`);
    try {
      return await this.client(target).call<T>(method, request, metadata, {
        idempotent,
        maxAttempts: 3,
        timeoutMs,
      });
    } catch (error) {
      this.logger.warn(`Event Manager gRPC call ${method} failed for ${target}.`);
      throw error;
    }
  }

  private client(target: string): GrpcUnaryClient {
    const normalizedTarget = target.trim();
    if (!normalizedTarget) throw new Error('Event Manager gRPC target is required.');
    let client = this.clients.get(normalizedTarget);
    if (!client) {
      client = new GrpcUnaryClient(normalizedTarget, this.service);
      this.clients.set(normalizedTarget, client);
    }
    return client;
  }
}

function isScoreItem(value: unknown): value is { userId: string; score: number } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const item = value as Record<string, unknown>;
  return typeof item['userId'] === 'string' && typeof item['score'] === 'number';
}
