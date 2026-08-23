import { resolveGrpcChannelCredentials, resolveGrpcServerCredentials } from './grpc-runtime';

describe('gRPC transport credentials', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.CACIC_GRPC_TLS_CA_CERT_PATH;
    delete process.env.CACIC_GRPC_TLS_CERT_PATH;
    delete process.env.CACIC_GRPC_TLS_KEY_PATH;
    delete process.env.CACIC_GRPC_ALLOW_INSECURE;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('allows plaintext only for loopback development targets', () => {
    process.env.NODE_ENV = 'development';

    expect(resolveGrpcServerCredentials('127.0.0.1:50051')).toBeDefined();
    expect(resolveGrpcChannelCredentials('localhost:50051')).toBeDefined();
    expect(() => resolveGrpcChannelCredentials('event-manager:50051')).toThrow(
      'Insecure gRPC transport is allowed only on loopback',
    );
  });

  it('rejects plaintext transport in production even on loopback', () => {
    process.env.NODE_ENV = 'production';

    expect(() => resolveGrpcServerCredentials('127.0.0.1:50051')).toThrow(
      'Insecure gRPC transport is allowed only on loopback',
    );
  });

  it('rejects partial TLS configuration', () => {
    process.env.NODE_ENV = 'production';
    process.env.CACIC_GRPC_TLS_CA_CERT_PATH = '/missing/ca.pem';

    expect(() => resolveGrpcChannelCredentials('event-manager:50051')).toThrow(
      'gRPC TLS requires CA, certificate, and private-key paths together',
    );
  });
});
