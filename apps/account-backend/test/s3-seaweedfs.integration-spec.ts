import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { Readable } from 'stream';
import { S3Service } from '../src/common/services/s3.service';

type ConfigValue = string | undefined;

const runIntegration = process.env.S3_INTEGRATION_TEST === 'true';
const describeIfIntegration = runIntegration ? describe : describe.skip;

const createConfigService = (): ConfigService => {
  const values: Record<string, ConfigValue> = {
    S3_ENDPOINT: process.env.S3_ENDPOINT,
    S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
    S3_SECRET_KEY: process.env.S3_SECRET_KEY,
    S3_BUCKET_NAME: process.env.S3_BUCKET_NAME,
    S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  };

  return {
    get: jest.fn((key: string, defaultValue?: ConfigValue) => {
      return values[key] ?? defaultValue;
    }),
  } as unknown as ConfigService;
};

const createRawClient = (): S3Client =>
  new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY ?? '',
      secretAccessKey: process.env.S3_SECRET_KEY ?? '',
    },
    forcePathStyle: true,
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

const streamToString = async (stream: Readable): Promise<string> => {
  const chunks: Buffer[] = [];

  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }

  return Buffer.concat(chunks).toString('utf8');
};

const createBucketIfMissing = async (
  client: S3Client,
  bucketName: string,
): Promise<void> => {
  try {
    await client.send(new CreateBucketCommand({ Bucket: bucketName }));
  } catch (error) {
    const name =
      error && typeof error === 'object' && 'name' in error
        ? String(error.name)
        : '';

    if (name !== 'BucketAlreadyOwnedByYou' && name !== 'BucketAlreadyExists') {
      throw error;
    }
  }
};

const emptyBucket = async (
  client: S3Client,
  bucketName: string,
): Promise<void> => {
  const response = await client.send(
    new ListObjectsV2Command({
      Bucket: bucketName,
    }),
  );
  const objects = (response.Contents ?? [])
    .filter((object) => object.Key)
    .map((object) => ({ Key: object.Key }));

  if (objects.length === 0) {
    return;
  }

  await client.send(
    new DeleteObjectsCommand({
      Bucket: bucketName,
      Delete: {
        Objects: objects,
      },
    }),
  );
};

describeIfIntegration('S3Service with SeaweedFS', () => {
  let rawClient: S3Client;
  let service: S3Service;
  const bucketName = process.env.S3_BUCKET_NAME ?? 'account-manager-test';

  beforeAll(async () => {
    rawClient = createRawClient();
    await createBucketIfMissing(rawClient, bucketName);
    await emptyBucket(rawClient, bucketName);
    service = new S3Service(createConfigService());
  });

  afterAll(async () => {
    if (rawClient) {
      await emptyBucket(rawClient, bucketName);
      rawClient.destroy();
    }
  });

  it('uploads, reads, lists, and deletes an object through SeaweedFS S3', async () => {
    const key = service.generateFileKey(
      'student-verification',
      'user-1',
      'proof.txt',
      new Date('2026-06-28T12:00:00.000Z'),
    );

    await expect(
      service.uploadFile(key, Buffer.from('document body'), 'text/plain', {
        userId: 'user-1',
      }),
    ).resolves.toEqual({
      key,
      size: 13,
    });

    await expect(service.fileExists(key)).resolves.toBe(true);
    await expect(service.getFileMetadata(key)).resolves.toEqual(
      expect.objectContaining({
        size: 13,
        contentType: 'text/plain',
        metadata: expect.objectContaining({
          userid: 'user-1',
        }) as Record<string, string>,
      }),
    );

    const download = await service.downloadFile(key);
    await expect(streamToString(download.stream)).resolves.toBe(
      'document body',
    );

    await expect(
      service.listFiles('student-verification/user-1/'),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          key,
          size: 13,
        }),
      ]),
    );

    await service.deleteFile(key);
    await expect(service.fileExists(key)).resolves.toBe(false);
  });
});
