import type { ConfigService } from '@nestjs/config';
import { S3Service } from './s3.service';

type S3ClientMock = {
  send: jest.Mock;
  destroy: jest.Mock;
};

const createContext = () => {
  const values: Record<string, string> = {
    S3_ENDPOINT: 'http://s3.test',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET_NAME: 'bucket',
    S3_REGION: 'us-east-1',
  };
  const config = {
    get: jest.fn((name: string, fallback?: string) => values[name] ?? fallback),
  };
  const service = new S3Service(config as unknown as ConfigService);
  const client = (service as unknown as { s3Client: S3ClientMock }).s3Client;
  client.send = jest.fn();
  client.destroy = jest.fn();
  return { service, client };
};

describe('S3Service', () => {
  it('classifies not-found head responses without leaking provider exceptions', async () => {
    const { service, client } = createContext();
    client.send.mockRejectedValue({ name: 'NotFound', $metadata: { httpStatusCode: 404 } });

    await expect(service.fileExists('missing')).resolves.toBe(false);
  });

  it('preserves provider status and retryability for storage failures', async () => {
    const { service, client } = createContext();
    client.send.mockRejectedValue({ name: 'ServiceUnavailable', $metadata: { httpStatusCode: 503 } });

    await expect(service.deleteFile('object-key')).rejects.toMatchObject({
      operation: 'delete',
      key: 'object-key',
      statusCode: 503,
      providerCode: 'ServiceUnavailable',
      retryable: true,
    });
  });

  it('destroys the provider client during application shutdown', () => {
    const { service, client } = createContext();

    service.onApplicationShutdown();

    expect(client.destroy).toHaveBeenCalledTimes(1);
  });

  it('sanitizes original filenames before composing object keys', () => {
    const { service } = createContext();

    const key = service.generateFileKey('student-verification', 'user/1', '../proof.pdf');

    expect(key).toMatch(/^student-verification\/user_1\/[0-9a-f-]{36}$/);
    expect(key).not.toContain('proof');
  });
});
