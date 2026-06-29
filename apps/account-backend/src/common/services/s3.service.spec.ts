import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import { S3Service } from './s3.service';

type MockCommandInput = Record<string, unknown>;
type MockCommand = {
  input: MockCommandInput;
};

type MockUploadInput = {
  client: unknown;
  params: {
    Bucket: string;
    Key: string;
    Body: Buffer | Readable;
    ContentType?: string;
    ContentLength?: number;
    Metadata?: Record<string, string>;
  };
};

const mockS3ClientConfigs: unknown[] = [];
const mockUploadCalls: MockUploadInput[] = [];
const mockSend = jest.fn<Promise<unknown>, [MockCommand]>();
const mockUploadDone = jest.fn<Promise<void>, [MockUploadInput]>();

jest.mock('@aws-sdk/client-s3', () => {
  class S3Client {
    constructor(config: unknown) {
      mockS3ClientConfigs.push(config);
    }

    send(command: MockCommand): Promise<unknown> {
      return mockSend(command);
    }
  }

  class GetObjectCommand {
    constructor(public readonly input: MockCommandInput) {}
  }

  class DeleteObjectCommand {
    constructor(public readonly input: MockCommandInput) {}
  }

  class HeadObjectCommand {
    constructor(public readonly input: MockCommandInput) {}
  }

  class ListObjectsV2Command {
    constructor(public readonly input: MockCommandInput) {}
  }

  return {
    S3Client,
    GetObjectCommand,
    DeleteObjectCommand,
    HeadObjectCommand,
    ListObjectsV2Command,
  };
});

jest.mock('@aws-sdk/lib-storage', () => ({
  Upload: jest.fn().mockImplementation((input: MockUploadInput) => {
    mockUploadCalls.push(input);

    return {
      done: () => mockUploadDone(input),
    };
  }),
}));

const createConfigService = (
  overrides: Record<string, string | undefined> = {},
): ConfigService => {
  const values: Record<string, string | undefined> = {
    S3_ENDPOINT: 'http://localhost:8333',
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_BUCKET_NAME: 'account-test',
    S3_REGION: 'us-east-1',
    ...overrides,
  };

  return {
    get: jest.fn((key: string, defaultValue?: string) => {
      return values[key] ?? defaultValue;
    }),
  } as unknown as ConfigService;
};

const readAll = async (stream: Readable): Promise<void> => {
  await new Promise<void>((resolve, reject) => {
    stream.on('data', () => undefined);
    stream.on('end', resolve);
    stream.on('error', reject);
  });
};

describe('S3Service', () => {
  beforeEach(() => {
    mockS3ClientConfigs.length = 0;
    mockUploadCalls.length = 0;
    mockSend.mockReset();
    mockUploadDone.mockReset();
    mockUploadDone.mockResolvedValue(undefined);
  });

  it('configures the SeaweedFS S3 client with path-style access', () => {
    const service = new S3Service(createConfigService());

    expect(service).toBeInstanceOf(S3Service);
    expect(mockS3ClientConfigs).toEqual([
      {
        endpoint: 'http://localhost:8333',
        region: 'us-east-1',
        credentials: {
          accessKeyId: 'test-access-key',
          secretAccessKey: 'test-secret-key',
        },
        forcePathStyle: true,
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      },
    ]);
  });

  it.each([
    ['S3_ENDPOINT'],
    ['S3_ACCESS_KEY'],
    ['S3_SECRET_KEY'],
    ['S3_BUCKET_NAME'],
  ])('rejects incomplete S3 config when %s is missing', (missingKey) => {
    expect(
      () => new S3Service(createConfigService({ [missingKey]: undefined })),
    ).toThrow(
      'S3 configuration is incomplete. Please check S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME environment variables.',
    );
  });

  it('uploads buffers with content metadata and returns the byte size', async () => {
    const service = new S3Service(createConfigService());
    const body = Buffer.from('student document');

    await expect(
      service.uploadFile('student/file.pdf', body, 'application/pdf', {
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      key: 'student/file.pdf',
      size: body.length,
    });

    expect(mockUploadCalls[0].params).toEqual({
      Bucket: 'account-test',
      Key: 'student/file.pdf',
      Body: body,
      ContentType: 'application/pdf',
      ContentLength: body.length,
      Metadata: {
        userId: 'user-1',
      },
    });
  });

  it('counts bytes while uploading streams', async () => {
    const service = new S3Service(createConfigService());
    mockUploadDone.mockImplementationOnce(async (input) => {
      await readAll(input.params.Body as Readable);
    });

    await expect(
      service.uploadFile(
        'student/file.txt',
        Readable.from(['abc', Buffer.from('de')]),
        'text/plain',
      ),
    ).resolves.toEqual({
      key: 'student/file.txt',
      size: 5,
    });

    expect(mockUploadCalls[0].params.ContentLength).toBeUndefined();
  });

  it('propagates source stream failures during uploads', async () => {
    const service = new S3Service(createConfigService());
    const source = new Readable({
      read() {
        this.destroy(new Error('stream broke'));
      },
    });
    mockUploadDone.mockImplementationOnce(async (input) => {
      await readAll(input.params.Body as Readable);
    });

    await expect(
      service.uploadFile('student/file.txt', source, 'text/plain'),
    ).rejects.toThrow('Failed to upload file: stream broke');
  });

  it('wraps upload failures with storage context', async () => {
    const service = new S3Service(createConfigService());
    mockUploadDone.mockRejectedValueOnce(new Error('network offline'));

    await expect(
      service.uploadFile('student/file.pdf', Buffer.from('pdf')),
    ).rejects.toThrow('Failed to upload file: network offline');
  });

  it('downloads files and returns response metadata', async () => {
    const service = new S3Service(createConfigService());
    const stream = Readable.from(['pdf']);
    mockSend.mockResolvedValueOnce({
      Body: stream,
      ContentType: 'application/pdf',
      ContentLength: 3,
      Metadata: {
        userId: 'user-1',
      },
    });

    await expect(service.downloadFile('student/file.pdf')).resolves.toEqual({
      stream,
      contentType: 'application/pdf',
      contentLength: 3,
      metadata: {
        userId: 'user-1',
      },
    });
    expect(mockSend.mock.calls[0][0].input).toEqual({
      Bucket: 'account-test',
      Key: 'student/file.pdf',
    });
  });

  it('treats empty download bodies as missing files', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockResolvedValueOnce({});

    await expect(service.downloadFile('student/file.pdf')).rejects.toThrow(
      'Failed to download file: File not found or empty',
    );
  });

  it('wraps download failures with storage context', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce(new Error('timeout'));

    await expect(service.downloadFile('student/file.pdf')).rejects.toThrow(
      'Failed to download file: timeout',
    );
  });

  it('deletes files by bucket and key', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockResolvedValueOnce({});

    await expect(
      service.deleteFile('student/file.pdf'),
    ).resolves.toBeUndefined();
    expect(mockSend.mock.calls[0][0].input).toEqual({
      Bucket: 'account-test',
      Key: 'student/file.pdf',
    });
  });

  it('wraps delete failures with storage context', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce(new Error('access denied'));

    await expect(service.deleteFile('student/file.pdf')).rejects.toThrow(
      'Failed to delete file: access denied',
    );
  });

  it('checks whether files exist', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockResolvedValueOnce({});

    await expect(service.fileExists('student/file.pdf')).resolves.toBe(true);
  });

  it('returns false when SeaweedFS reports a missing object', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce({ name: 'NotFound' });

    await expect(service.fileExists('student/file.pdf')).resolves.toBe(false);
  });

  it('returns false when S3 reports a 404 object response', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } });

    await expect(service.fileExists('student/file.pdf')).resolves.toBe(false);
  });

  it('rethrows unexpected existence-check failures', async () => {
    const service = new S3Service(createConfigService());
    const error = new Error('permission denied');
    mockSend.mockRejectedValueOnce(error);

    await expect(service.fileExists('student/file.pdf')).rejects.toBe(error);
  });

  it('reads file metadata without downloading the object', async () => {
    const service = new S3Service(createConfigService());
    const lastModified = new Date('2026-06-28T12:00:00.000Z');
    mockSend.mockResolvedValueOnce({
      ContentLength: 42,
      LastModified: lastModified,
      ContentType: 'application/pdf',
      Metadata: {
        original: 'proof.pdf',
      },
    });

    await expect(service.getFileMetadata('student/file.pdf')).resolves.toEqual({
      size: 42,
      lastModified,
      contentType: 'application/pdf',
      metadata: {
        original: 'proof.pdf',
      },
    });
  });

  it('wraps metadata failures with storage context', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce(new Error('metadata unavailable'));

    await expect(service.getFileMetadata('student/file.pdf')).rejects.toThrow(
      'Failed to get file metadata: metadata unavailable',
    );
  });

  it('lists files across paginated SeaweedFS responses', async () => {
    const service = new S3Service(createConfigService());
    const firstDate = new Date('2026-06-28T12:00:00.000Z');
    const secondDate = new Date('2026-06-28T12:01:00.000Z');
    mockSend
      .mockResolvedValueOnce({
        IsTruncated: true,
        NextContinuationToken: 'next-page',
        Contents: [
          {
            Key: 'student/user-1/a.pdf',
            Size: 1,
            LastModified: firstDate,
          },
          {
            Size: 999,
          },
        ],
      })
      .mockResolvedValueOnce({
        IsTruncated: false,
        Contents: [
          {
            Key: 'student/user-1/b.pdf',
            Size: 2,
            LastModified: secondDate,
          },
        ],
      });

    await expect(service.listFiles('student/user-1/')).resolves.toEqual([
      {
        key: 'student/user-1/a.pdf',
        size: 1,
        lastModified: firstDate,
      },
      {
        key: 'student/user-1/b.pdf',
        size: 2,
        lastModified: secondDate,
      },
    ]);
    expect(mockSend.mock.calls.map(([command]) => command.input)).toEqual([
      {
        Bucket: 'account-test',
        Prefix: 'student/user-1/',
        ContinuationToken: undefined,
      },
      {
        Bucket: 'account-test',
        Prefix: 'student/user-1/',
        ContinuationToken: 'next-page',
      },
    ]);
  });

  it('wraps list failures with storage context', async () => {
    const service = new S3Service(createConfigService());
    mockSend.mockRejectedValueOnce(new Error('list failed'));

    await expect(service.listFiles('student/')).rejects.toThrow(
      'Failed to list files: list failed',
    );
  });

  it('generates deterministic file keys when a timestamp is provided', () => {
    const service = new S3Service(createConfigService());

    expect(
      service.generateFileKey(
        'student-verification',
        'user-1',
        'proof.pdf',
        new Date('2026-06-28T12:34:56.789Z'),
      ),
    ).toBe('student-verification/user-1/2026-06-28T12-34-56-789Z-proof.pdf');
  });
});
