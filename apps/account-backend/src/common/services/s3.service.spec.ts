import type { ConfigService } from '@nestjs/config';
import { Logger } from '@nestjs/common';
import { AbortMultipartUploadCommand, CreateMultipartUploadCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { getS3ErrorDetails, S3Service } from './s3.service';

type S3ClientMock = {
  send: jest.Mock;
  destroy: jest.Mock;
};

const createContext = (overrides: Record<string, string> = {}) => {
  const values: Record<string, string> = {
    S3_ENDPOINT: 'http://s3.test',
    S3_ACCESS_KEY: 'access',
    S3_SECRET_KEY: 'secret',
    S3_BUCKET_NAME: 'bucket',
    S3_REGION: 'us-east-1',
    ...overrides,
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
  let errorLog: jest.SpyInstance;
  let warnLog: jest.SpyInstance;
  beforeEach(() => {
    errorLog = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    warnLog = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('accepts an active upload lasting longer than the old 30-second deadline', async () => {
    jest.useFakeTimers();
    const { service, client } = createContext();
    client.send.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve({}), 31_000)));
    const result = service.uploadFile('slow', Buffer.from('zip'));

    await jest.advanceTimersByTimeAsync(31_000);

    await expect(result).resolves.toEqual({ key: 'slow', size: 3 });
    expect(jest.getTimerCount()).toBe(0);
  });

  it('replays transient failures from a new stream while preserving the object key', async () => {
    const { service, client } = createContext();
    const streams: Readable[] = [];
    const factory = jest.fn(() => {
      const stream = Readable.from([Buffer.from('complete zip')]);
      streams.push(stream);
      return stream;
    });
    client.send
      .mockRejectedValueOnce(
        Object.assign(new Error('temporarily unavailable'), {
          name: 'ServiceUnavailable',
          $metadata: { httpStatusCode: 503, requestId: 'provider-request', attempts: 3 },
        }),
      )
      .mockResolvedValue({});

    await expect(service.uploadFile('same-key', factory)).resolves.toEqual({ key: 'same-key', size: 12 });

    expect(factory).toHaveBeenCalledTimes(2);
    expect(streams.every((stream) => stream.destroyed)).toBe(true);
    const commands = client.send.mock.calls.map(([command]: [PutObjectCommand]) => command);
    expect(commands.map((command) => command.input.Key)).toEqual(['same-key', 'same-key']);
    expect(commands.map((command) => command.input.Body)).toEqual([
      Buffer.from('complete zip'),
      Buffer.from('complete zip'),
    ]);
    expect(warnLog).toHaveBeenCalledWith(
      expect.objectContaining({
        attempt: 1,
        willRetry: true,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        provider: expect.objectContaining({ requestId: 'provider-request', sdkAttempts: 3 }),
      }),
    );
  });

  it('does not replay consumed raw streams or permanent authorization failures', async () => {
    const { service, client } = createContext();
    client.send.mockRejectedValue(Object.assign(new Error('unavailable'), { code: 'ECONNRESET' }));
    await expect(service.uploadFile('raw', Readable.from([Buffer.from('zip')]))).rejects.toMatchObject({
      retryable: true,
    });
    expect(client.send).toHaveBeenCalledTimes(1);

    client.send.mockClear().mockRejectedValue(
      Object.assign(new Error('access denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
        cause: Object.assign(new Error('earlier socket failure'), { code: 'ECONNRESET' }),
      }),
    );
    await expect(service.uploadFile('denied', Buffer.from('zip'))).rejects.toMatchObject({ retryable: false });
    expect(client.send).toHaveBeenCalledTimes(1);
  });

  it('stops stalled stream production and records the timeout policy and byte counts', async () => {
    const { service } = createContext({ S3_UPLOAD_IDLE_TIMEOUT_MS: '10', S3_UPLOAD_MAX_ATTEMPTS: '1' });
    const source = new Readable({
      read() {
        /* Deliberately stalled producer. */
      },
    });

    await expect(service.uploadFile('stalled', source)).rejects.toMatchObject({
      retryable: true,
      diagnostics: { timeoutReason: 'idle', bytesRead: 0, bytesUploaded: 0, idleTimeoutMs: 10 },
    });
    expect(source.destroyed).toBe(true);
    expect(source.listenerCount('error')).toBe(0);
  });

  it('cancels in-flight multipart requests and leaves a live signal for cleanup', async () => {
    const { service, client } = createContext({ S3_UPLOAD_IDLE_TIMEOUT_MS: '20', S3_UPLOAD_MAX_ATTEMPTS: '1' });
    let requestSignal: AbortSignal | undefined;
    let cleanupSignal: AbortSignal | undefined;
    client.send.mockImplementation((command: unknown, options: { abortSignal: AbortSignal }) => {
      if (command instanceof CreateMultipartUploadCommand) return Promise.resolve({ UploadId: 'upload-1' });
      if (command instanceof AbortMultipartUploadCommand) {
        cleanupSignal = options.abortSignal;
        return Promise.resolve({});
      }
      requestSignal = options.abortSignal;
      return new Promise((_resolve, reject) =>
        options.abortSignal.addEventListener(
          'abort',
          () => {
            reject(Object.assign(new Error('HTTP request cancelled'), { name: 'AbortError' }));
          },
          { once: true },
        ),
      );
    });

    await expect(service.uploadFile('multipart', Buffer.alloc(6 * 1024 * 1024))).rejects.toMatchObject({
      diagnostics: { timeoutReason: 'idle' },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(requestSignal?.aborted).toBe(true);
    expect(cleanupSignal?.aborted).toBe(false);
    expect(cleanupSignal).not.toBe(requestSignal);
  });

  it('preserves the original provider failure when multipart cleanup also fails', async () => {
    const { service, client } = createContext({ S3_UPLOAD_MAX_ATTEMPTS: '1' });
    client.send.mockImplementation((command: unknown) => {
      if (command instanceof CreateMultipartUploadCommand) return Promise.resolve({ UploadId: 'upload-1' });
      return Promise.reject(
        Object.assign(
          new Error(command instanceof AbortMultipartUploadCommand ? 'cleanup denied' : 'part unavailable'),
          { $metadata: { httpStatusCode: command instanceof AbortMultipartUploadCommand ? 403 : 503 } },
        ),
      );
    });

    await expect(service.uploadFile('multipart', Buffer.alloc(6 * 1024 * 1024))).rejects.toMatchObject({
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      diagnostics: {
        requestFailures: expect.arrayContaining([
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          expect.objectContaining({
            command: 'UploadPartCommand',
            error: expect.objectContaining({ message: 'part unavailable' }),
          }),
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          expect.objectContaining({
            command: 'AbortMultipartUploadCommand',
            error: expect.objectContaining({ message: 'cleanup denied' }),
          }),
        ]),
      },
    });
    expect(warnLog).toHaveBeenCalledWith(expect.objectContaining({ message: 'S3 multipart cleanup failed' }));
  });

  it('propagates source failures and removes its stream listeners', async () => {
    const { service, client } = createContext();
    const source = new Readable({
      read() {
        this.destroy(new Error('ZIP generation failed'));
      },
    });

    await expect(service.uploadFile('broken-source', source)).rejects.toMatchObject({
      message: 'upload failed: ZIP generation failed',
      retryable: false,
    });
    expect(client.send).not.toHaveBeenCalled();
    expect(source.destroyed).toBe(true);
    expect(source.listenerCount('error')).toBe(0);
  });

  it('enforces the overall deadline even when the idle deadline has not elapsed', async () => {
    jest.useFakeTimers();
    const { service, client } = createContext({ S3_UPLOAD_TIMEOUT_MS: '100', S3_UPLOAD_IDLE_TIMEOUT_MS: '1000' });
    client.send.mockImplementation(
      (_command: unknown, options: { abortSignal: AbortSignal }) =>
        new Promise((_resolve, reject) =>
          options.abortSignal.addEventListener('abort', () => {
            reject(Object.assign(new Error('cancelled'), { name: 'AbortError' }));
          }),
        ),
    );
    const result = expect(service.uploadFile('deadline', Buffer.from('zip'))).rejects.toMatchObject({
      diagnostics: { timeoutReason: 'deadline', attempt: 1 },
    });
    await jest.advanceTimersByTimeAsync(100);
    await result;
    expect(client.send).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('logs nested socket causes without serializing provider requests or headers', async () => {
    const { service, client } = createContext({ S3_UPLOAD_MAX_ATTEMPTS: '1' });
    const cause = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET', syscall: 'read' });
    const error = Object.assign(new Error('request failed', { cause }), {
      $metadata: { httpStatusCode: 503, requestId: 'req-123', attempts: 3, totalRetryDelay: 42 },
      $response: { headers: { authorization: 'secret' }, body: 'private export' },
    });
    client.send.mockRejectedValue(error);

    await expect(service.uploadFile('diagnostics', Buffer.from('zip'))).rejects.toMatchObject({
      cause: error,
      retryable: true,
      diagnostics: {
        provider: {
          requestId: 'req-123',
          sdkAttempts: 3,
          totalRetryDelayMs: 42,
          cause: { code: 'ECONNRESET', syscall: 'read', message: 'socket hang up' },
        },
      },
    });
    expect(JSON.stringify(getS3ErrorDetails(error))).not.toMatch(/secret|private export|authorization/);
    expect(errorLog).toHaveBeenCalledWith(
      expect.objectContaining({
        bytesRead: 3,
        willRetry: false,
      }),
      expect.any(String),
    );
  });

  it('bounds transient retries and validates timeout configuration', async () => {
    jest.useFakeTimers();
    const { service, client } = createContext({ S3_UPLOAD_MAX_ATTEMPTS: '2' });
    client.send.mockRejectedValue(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }));
    const result = expect(service.uploadFile('bounded', Buffer.from('zip'))).rejects.toMatchObject({
      diagnostics: { attempt: 2, maxAttempts: 2 },
    });
    await jest.advanceTimersByTimeAsync(500);
    await result;
    expect(client.send).toHaveBeenCalledTimes(2);
    expect(() => createContext({ S3_UPLOAD_TIMEOUT_MS: '0' })).toThrow('S3_UPLOAD_TIMEOUT_MS');
    expect(() => createContext({ S3_UPLOAD_MAX_ATTEMPTS: '6' })).toThrow('S3_UPLOAD_MAX_ATTEMPTS');
  });

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
