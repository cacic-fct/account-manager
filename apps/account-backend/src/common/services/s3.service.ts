import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type _Object,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, Transform } from 'stream';
import { randomUUID } from 'crypto';

export class S3ServiceError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly key: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
    readonly retryable = false,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'S3ServiceError';
  }
}

export interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  region: string;
}

@Injectable()
export class S3Service implements OnApplicationShutdown {
  private readonly logger = new Logger(S3Service.name);
  private readonly s3Client!: S3Client;
  private readonly bucketName!: string;
  private readonly requestTimeoutMs = 30_000;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('S3_ENDPOINT');
    const accessKeyId = this.configService.get<string>('S3_ACCESS_KEY');
    const secretAccessKey = this.configService.get<string>('S3_SECRET_KEY');
    const bucketName = this.configService.get<string>('S3_BUCKET_NAME');
    const region = this.configService.get<string>('S3_REGION', 'us-east-1');

    if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
      throw new Error(
        'S3 configuration is incomplete. Please check S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, and S3_BUCKET_NAME environment variables.',
      );
    }

    this.bucketName = bucketName;

    // Configure S3 client for SeaweedFS
    this.s3Client = new S3Client({
      endpoint,
      region,
      credentials: {
        accessKeyId,
        secretAccessKey,
      },
      forcePathStyle: true, // Required for SeaweedFS S3 API
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });

    this.logger.debug(`S3Service initialized with endpoint: ${endpoint}, bucket: ${bucketName}`);
  }

  onApplicationShutdown(): void {
    this.s3Client.destroy();
  }

  /**
   * Upload a file to S3-compatible storage
   */
  async uploadFile(
    key: string,
    body: Buffer | Readable,
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; size: number }> {
    try {
      let uploadedSize = 0;
      let uploadBody: Buffer | Readable;

      if (Buffer.isBuffer(body)) {
        uploadedSize = body.length;
        uploadBody = body;
      } else {
        uploadBody = this.createCountingStream(body, (byteLength) => {
          uploadedSize += byteLength;
        });
      }

      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
      const upload = new Upload({
        client: this.s3Client,
        abortController,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: uploadBody,
          ContentType: contentType,
          ContentLength: Buffer.isBuffer(body) ? body.length : undefined,
          Metadata: metadata,
        },
      });

      try {
        await upload.done();
      } finally {
        clearTimeout(timeout);
      }

      this.logger.debug(`File uploaded successfully: ${key}`);
      return {
        key,
        size: uploadedSize,
      };
    } catch (error: unknown) {
      const storageError = this.toStorageError('upload', key, error);
      this.logger.error(`Failed to upload file ${key}: ${storageError.message}`);
      throw storageError;
    }
  }

  private createCountingStream(body: Readable, countBytes: (byteLength: number) => void): Readable {
    const countingStream = new Transform({
      transform(chunk: Buffer | string, encoding, callback) {
        countBytes(typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength);
        callback(null, chunk);
      },
    });

    body.on('error', (error) => {
      countingStream.destroy(error);
    });

    body.pipe(countingStream);

    return countingStream;
  }

  /**
   * Download a file from S3-compatible storage
   */
  async downloadFile(key: string): Promise<{
    stream: Readable;
    contentType?: string;
    contentLength?: number;
    metadata?: Record<string, string>;
  }> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const response = await this.send('download', key, (abortSignal) => this.s3Client.send(command, { abortSignal }));

      if (!response.Body) {
        throw new Error('File not found or empty');
      }

      return {
        stream: response.Body as Readable,
        contentType: response.ContentType,
        contentLength: response.ContentLength,
        metadata: response.Metadata,
      };
    } catch (error: unknown) {
      const storageError = this.toStorageError('download', key, error);
      this.logger.error(`Failed to download file ${key}: ${storageError.message}`);
      throw storageError;
    }
  }

  /**
   * Delete a file from S3-compatible storage
   */
  async deleteFile(key: string): Promise<void> {
    try {
      await this.send('delete', key, (abortSignal) =>
        this.s3Client.send(
          new DeleteObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
          { abortSignal },
        ),
      );

      this.logger.debug(`File deleted successfully: ${key}`);
    } catch (error: unknown) {
      const storageError = this.toStorageError('delete', key, error);
      if (storageError.statusCode === 404 || ['NotFound', 'NoSuchKey'].includes(storageError.providerCode ?? '')) {
        this.logger.debug(`File already absent during delete: ${key}`);
        return;
      }
      this.logger.error(`Failed to delete file ${key}: ${storageError.message}`);
      throw storageError;
    }
  }

  /**
   * Check if a file exists in S3-compatible storage
   */
  async fileExists(key: string): Promise<boolean> {
    try {
      await this.send('head', key, (abortSignal) =>
        this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
          { abortSignal },
        ),
      );
      return true;
    } catch (error: unknown) {
      const storageError = this.toStorageError('head', key, error);
      if (storageError.statusCode === 404 || storageError.providerCode === 'NotFound') {
        return false;
      }
      throw storageError;
    }
  }

  /**
   * Get file metadata without downloading the content
   */
  async getFileMetadata(key: string): Promise<{
    size: number;
    lastModified?: Date;
    contentType?: string;
    metadata?: Record<string, string>;
  }> {
    try {
      const response = await this.send('metadata', key, (abortSignal) =>
        this.s3Client.send(
          new HeadObjectCommand({
            Bucket: this.bucketName,
            Key: key,
          }),
          { abortSignal },
        ),
      );

      return {
        size: response.ContentLength || 0,
        lastModified: response.LastModified,
        contentType: response.ContentType,
        metadata: response.Metadata,
      };
    } catch (error: unknown) {
      const storageError = this.toStorageError('metadata', key, error);
      this.logger.error(`Failed to get metadata for file ${key}: ${storageError.message}`);
      throw storageError;
    }
  }

  /**
   * List files in a directory (prefix)
   */
  async listFiles(prefix?: string): Promise<
    Array<{
      key: string;
      size: number;
      lastModified?: Date;
    }>
  > {
    try {
      const contents: _Object[] = [];
      let continuationToken: string | undefined;
      let isTruncated = true;

      while (isTruncated) {
        const response = await this.send('list', prefix ?? '', (abortSignal) =>
          this.s3Client.send(
            new ListObjectsV2Command({
              Bucket: this.bucketName,
              Prefix: prefix,
              ContinuationToken: continuationToken,
            }),
            { abortSignal },
          ),
        );

        contents.push(...(response.Contents ?? []));
        continuationToken = response.NextContinuationToken;
        isTruncated = response.IsTruncated === true && !!continuationToken;
      }

      return contents
        .filter((obj): obj is _Object & { Key: string } => !!obj.Key)
        .map((obj) => ({
          key: obj.Key,
          size: obj.Size || 0,
          lastModified: obj.LastModified,
        }));
    } catch (error: unknown) {
      const storageError = this.toStorageError('list', prefix ?? '', error);
      this.logger.error(`Failed to list files with prefix ${prefix}: ${storageError.message}`);
      throw storageError;
    }
  }

  /**
   * Generate an opaque object key. The display/original filename belongs in database metadata,
   * never in the storage path where bucket listings and provider logs can expose it.
   */
  generateFileKey(
    category: 'lgpd' | 'student-verification',
    userId: string,
    filename: string,
    timestamp?: Date,
  ): string {
    // Keep the arguments for the existing caller contract; they now identify metadata owned by
    // the caller and must not influence the object key.
    void filename;
    void timestamp;
    return `${category}/${this.sanitizePathSegment(userId)}/${randomUUID()}`;
  }

  private async send<T>(
    operation: string,
    key: string,
    sendOperation: (abortSignal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), this.requestTimeoutMs);

    try {
      return await sendOperation(abortController.signal);
    } catch (error: unknown) {
      throw this.toStorageError(operation, key, error);
    } finally {
      clearTimeout(timeout);
    }
  }

  private toStorageError(operation: string, key: string, error: unknown): S3ServiceError {
    if (error instanceof S3ServiceError) {
      return error;
    }

    const candidate = this.isRecord(error) ? error : {};
    const metadata = this.isRecord(candidate['$metadata']) ? candidate['$metadata'] : {};
    const statusCode = this.getNumber(metadata['httpStatusCode']);
    const providerCode =
      this.getString(candidate['Code']) ?? this.getString(candidate['code']) ?? this.getString(candidate['name']);
    const message = error instanceof Error ? error.message : 'Unknown storage error';
    const timedOut = error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');
    const retryable =
      timedOut ||
      statusCode === 429 ||
      (statusCode !== undefined && statusCode >= 500) ||
      ['TimeoutError', 'RequestTimeout', 'Throttling', 'SlowDown', 'ServiceUnavailable'].includes(providerCode ?? '');

    return new S3ServiceError(
      `${operation} failed${timedOut ? ' due to timeout' : ''}: ${message}`,
      operation,
      key,
      statusCode,
      providerCode,
      retryable,
      error instanceof Error ? { cause: error } : undefined,
    );
  }

  private sanitizePathSegment(value: string): string {
    return (
      value
        .normalize('NFKC')
        .replace(/[\\/]/g, '_')
        .split('')
        .map((character) => {
          const code = character.charCodeAt(0);
          return code <= 31 || code === 127 ? '_' : character;
        })
        .join('')
        .replace(/\.\./g, '_')
        .replace(/[^\p{L}\p{N}._-]/gu, '_')
        .replace(/_+/g, '_')
        .replace(/^\.+$/, '_')
        .slice(0, 180) || '_'
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
  }

  private getString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
  }

  private getNumber(value: unknown): number | undefined {
    return typeof value === 'number' ? value : undefined;
  }
}
