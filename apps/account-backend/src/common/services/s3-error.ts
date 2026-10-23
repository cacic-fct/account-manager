export interface S3ErrorDetails {
  name?: string;
  message?: string;
  stack?: string;
  code?: string;
  syscall?: string;
  statusCode?: number;
  requestId?: string;
  extendedRequestId?: string;
  sdkAttempts?: number;
  totalRetryDelayMs?: number;
  cause?: S3ErrorDetails;
  errors?: S3ErrorDetails[];
}

// Read only diagnostic fields; never serialize provider requests, headers, credentials or bodies.
export function getS3ErrorDetails(error: unknown, depth = 0): S3ErrorDetails {
  if (typeof error !== 'object' || error === null) {
    return { message: typeof error === 'string' ? error : 'Unknown storage error' };
  }
  const candidate = error as Record<string, unknown>;
  const metadata = candidate['$metadata'] as Record<string, unknown> | undefined;
  const string = (value: unknown) => (typeof value === 'string' ? value : undefined);
  const number = (value: unknown) => (typeof value === 'number' ? value : undefined);
  return {
    name: string(candidate['name']),
    message: string(candidate['message']) ?? string(candidate['Message']),
    stack: string(candidate['stack']),
    code: string(candidate['Code']) ?? string(candidate['code']),
    syscall: string(candidate['syscall']),
    statusCode: number(metadata?.['httpStatusCode']),
    requestId: string(metadata?.['requestId']),
    extendedRequestId: string(metadata?.['extendedRequestId']),
    sdkAttempts: number(metadata?.['attempts']),
    totalRetryDelayMs: number(metadata?.['totalRetryDelay']),
    cause: depth < 4 && candidate['cause'] ? getS3ErrorDetails(candidate['cause'], depth + 1) : undefined,
    errors:
      depth < 4 && Array.isArray(candidate['errors'])
        ? candidate['errors'].slice(0, 5).map((cause: unknown) => getS3ErrorDetails(cause, depth + 1))
        : undefined,
  };
}

export class S3ServiceError extends Error {
  constructor(
    message: string,
    readonly operation: string,
    readonly key: string,
    readonly statusCode?: number,
    readonly providerCode?: string,
    readonly retryable = false,
    options?: ErrorOptions,
    readonly diagnostics?: Record<string, unknown>,
  ) {
    super(message, options);
    this.name = 'S3ServiceError';
  }
}
