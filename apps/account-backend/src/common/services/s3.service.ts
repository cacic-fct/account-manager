import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  AbortMultipartUploadCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  type _Object,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable, Transform } from 'stream';
import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'node:timers/promises';

import { getS3ErrorDetails, S3ServiceError, type S3ErrorDetails } from './s3-error';

export { getS3ErrorDetails, S3ServiceError } from './s3-error';

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
  private readonly uploadIdleTimeoutMs: number;
  private readonly uploadTimeoutMs: number;
  private readonly uploadMaxAttempts: number;

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
    this.uploadIdleTimeoutMs = this.readPositiveInteger('S3_UPLOAD_IDLE_TIMEOUT_MS', 120_000, 600_000);
    this.uploadTimeoutMs = this.readPositiveInteger('S3_UPLOAD_TIMEOUT_MS', 600_000, 600_000);
    this.uploadMaxAttempts = this.readPositiveInteger('S3_UPLOAD_MAX_ATTEMPTS', 3, 5);

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
    body: Buffer | Readable | (() => Readable),
    contentType?: string,
    metadata?: Record<string, string>,
  ): Promise<{ key: string; size: number }> {
    const startedAt = Date.now();
    // Consumed streams cannot be replayed. Callers generating archives supply a fresh-stream factory.
    const maxAttempts = body instanceof Readable ? 1 : this.uploadMaxAttempts;

    for (let attempt = 1; ; attempt++) {
      const abortController = new AbortController();
      let timeoutReason: 'idle' | 'deadline' | undefined;
      let attemptFinished = false;
      let source: Buffer | Readable | undefined;
      let uploadBody: Buffer | Readable | undefined;
      let bytesRead = 0;
      let bytesUploaded = 0;
      let lastPart: number | undefined;
      const requestFailures: { command: string; error: S3ErrorDetails }[] = [];
      let lastActivityAt = Date.now();
      let idleTimeout: ReturnType<typeof setTimeout> | undefined;
      const abort = (reason: 'idle' | 'deadline') => {
        timeoutReason ??= reason;
        abortController.abort();
        // Upload.done() races abort against its workers; also stop the input and the HTTP requests.
        if (uploadBody instanceof Readable) uploadBody.destroy();
        if (source instanceof Readable) source.destroy();
      };
      const activity = () => {
        if (attemptFinished || abortController.signal.aborted) return;
        lastActivityAt = Date.now();
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => abort('idle'), this.uploadIdleTimeoutMs);
      };
      const remainingMs = this.uploadTimeoutMs - (Date.now() - startedAt);
      const deadline = setTimeout(() => abort('deadline'), Math.max(0, remainingMs));
      activity();
      let failure: S3ServiceError;

      try {
        source = typeof body === 'function' ? body() : body;
        if (Buffer.isBuffer(source)) {
          bytesRead = source.length;
          uploadBody = source;
        } else {
          uploadBody = this.createCountingStream(source, (size) => {
            bytesRead += size;
            activity();
          });
        }
        const upload = new Upload({
          client: this.createUploadClient(key, abortController.signal, requestFailures),
          abortController,
          leavePartsOnError: false,
          params: {
            Bucket: this.bucketName,
            Key: key,
            Body: uploadBody,
            ContentType: contentType,
            ContentLength: Buffer.isBuffer(source) ? source.length : undefined,
            Metadata: metadata,
          },
        });
        upload.on('httpUploadProgress', (progress) => {
          if ((progress.loaded ?? 0) > bytesUploaded) activity();
          bytesUploaded = progress.loaded ?? bytesUploaded;
          lastPart = progress.part;
        });
        await upload.done();
        this.logger.debug({
          message: 'S3 upload completed',
          key,
          attempt,
          bytesRead,
          elapsedMs: Date.now() - startedAt,
        });
        return { key, size: bytesRead };
      } catch (error: unknown) {
        const storageError = this.toStorageError('upload', key, error);
        const diagnostics = {
          attempt,
          maxAttempts,
          elapsedMs: Date.now() - startedAt,
          idleMs: Date.now() - lastActivityAt,
          idleTimeoutMs: this.uploadIdleTimeoutMs,
          timeoutMs: this.uploadTimeoutMs,
          timeoutReason,
          bytesRead,
          bytesUploaded,
          lastPart,
          provider: getS3ErrorDetails(error),
          requestFailures: [...requestFailures],
        };
        failure = new S3ServiceError(
          timeoutReason
            ? `upload ${timeoutReason === 'idle' ? 'inactivity timeout' : 'overall deadline exceeded'} after ${diagnostics.elapsedMs}ms`
            : storageError.message,
          'upload',
          key,
          storageError.statusCode,
          storageError.providerCode,
          !!timeoutReason || storageError.retryable,
          { cause: error },
          diagnostics,
        );
      } finally {
        attemptFinished = true;
        clearTimeout(deadline);
        clearTimeout(idleTimeout);
        if (uploadBody instanceof Readable) uploadBody.destroy();
        if (source instanceof Readable) source.destroy();
      }

      const retryDelayMs = 500 * 2 ** (attempt - 1);
      const willRetry =
        failure.retryable && attempt < maxAttempts && Date.now() - startedAt + retryDelayMs < this.uploadTimeoutMs;
      const log = {
        message: failure.message,
        operation: 'upload',
        key,
        retryable: failure.retryable,
        statusCode: failure.statusCode,
        providerCode: failure.providerCode,
        willRetry,
        ...failure.diagnostics,
      };
      if (!willRetry) {
        this.logger.error(log, failure.stack);
        throw failure;
      }
      this.logger.warn({ ...log, retryDelayMs });
      await delay(retryDelayMs);
    }
  }

  private createUploadClient(
    key: string,
    abortSignal: AbortSignal,
    failures: { command: string; error: S3ErrorDetails }[],
  ): S3Client {
    // lib-storage does not pass its AbortController to client.send(). Forward it explicitly,
    // keeping multipart cleanup on a separate bounded signal so cancellation can still clean up.
    return new Proxy(this.s3Client, {
      get: (client, property) => {
        if (property !== 'send') return Reflect.get(client, property) as unknown;
        return async (command: Parameters<S3Client['send']>[0]) => {
          const cleanup = command instanceof AbortMultipartUploadCommand;
          try {
            return await client.send(command, {
              abortSignal: cleanup ? AbortSignal.timeout(this.requestTimeoutMs) : abortSignal,
            });
          } catch (error) {
            const details = getS3ErrorDetails(error);
            if (failures.length < 5) failures.push({ command: command.constructor.name, error: details });
            if (cleanup) this.logger.warn({ message: 'S3 multipart cleanup failed', key, provider: details });
            throw error;
          }
        };
      },
    });
  }

  private createCountingStream(body: Readable, countBytes: (byteLength: number) => void): Readable {
    const countingStream = new Transform({
      transform(chunk: Buffer | string, encoding, callback) {
        countBytes(typeof chunk === 'string' ? Buffer.byteLength(chunk, encoding) : chunk.byteLength);
        callback(null, chunk);
      },
    });
    const onError = (error: Error) => countingStream.destroy(error);
    const onClose = () => {
      if (!body.readableEnded && !countingStream.destroyed) {
        countingStream.destroy(new Error('Upload source closed before reaching end'));
      }
    };
    body.on('error', onError);
    body.on('close', onClose);
    countingStream.once('close', () => {
      body.unpipe(countingStream);
      body.off('error', onError);
      body.off('close', onClose);
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
    const details = getS3ErrorDetails(error);
    const message = details.message ?? 'Unknown storage error';
    const timedOut = providerCode === 'TimeoutError' || providerCode === 'RequestTimeout';
    const permanentClientFailure =
      statusCode !== undefined && statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
    const retryable =
      !permanentClientFailure &&
      (timedOut ||
        providerCode === 'AbortError' ||
        statusCode === 408 ||
        statusCode === 429 ||
        (statusCode !== undefined && statusCode >= 500) ||
        [
          'TimeoutError',
          'RequestTimeout',
          'Throttling',
          'SlowDown',
          'ServiceUnavailable',
          'ECONNRESET',
          'ECONNREFUSED',
          'ETIMEDOUT',
          'EPIPE',
          'EAI_AGAIN',
        ].includes(providerCode ?? '') ||
        this.hasRetryableCause(details));

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

  private hasRetryableCause(details: S3ErrorDetails): boolean {
    const codes = ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'];
    return (
      details.name === 'TimeoutError' ||
      codes.includes(details.code ?? '') ||
      (!!details.cause && this.hasRetryableCause(details.cause)) ||
      (details.errors?.some((error) => this.hasRetryableCause(error)) ?? false)
    );
  }

  private readPositiveInteger(name: string, fallback: number, maximum: number): number {
    const value = Number(this.configService.get<string>(name) ?? fallback);
    if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
      throw new Error(`${name} must be an integer between 1 and ${maximum}`);
    }
    return value;
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
