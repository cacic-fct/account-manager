import type { JwtService } from '../auth/jwt/jwt.service';
import { EventManagerGrpcClient } from './event-manager-grpc.client';
import { GrpcUnaryClient } from './grpc-runtime';

describe('EventManagerGrpcClient', () => {
  const jwt = {
    getClientCredentialsToken: jest.fn().mockResolvedValue('access-token'),
  };
  let call: jest.SpiedFunction<GrpcUnaryClient['call']>;
  let client: EventManagerGrpcClient;

  beforeEach(() => {
    jest.clearAllMocks();
    call = jest.spyOn(GrpcUnaryClient.prototype, 'call');
    client = new EventManagerGrpcClient(jwt as unknown as JwtService);
  });

  afterEach(() => {
    client.onModuleDestroy();
    call.mockRestore();
  });

  it('normalizes merge scores returned by Event Manager', async () => {
    call.mockResolvedValue({
      scores: [
        { userId: 'user-1', score: 42 },
        { userId: 'invalid', score: 'not-a-number' },
      ],
    });

    await expect(client.scoreAccounts('events:50051', 'event-audience', ['user-1'], 5_000)).resolves.toEqual({
      'user-1': 42,
    });
  });

  it('decodes structured LGPD data transported in the protobuf response', async () => {
    call.mockResolvedValue({ json: '{"subscriptions":[]}' });
    await expect(
      client.collectLgpdData('events:50051', 'event-audience', {
        userId: 'user-1',
      }),
    ).resolves.toEqual({ subscriptions: [] });
  });
});
