type StartupConfig = Record<string, unknown>;

const REQUIRED_IN_ALL_ENVIRONMENTS = [
  'DATABASE_URL',
  'BACKEND_URL',
  'FRONTEND_URL',
  'SESSION_SECRET',
  'S3_ENDPOINT',
  'S3_ACCESS_KEY',
  'S3_SECRET_KEY',
  'S3_BUCKET_NAME',
] as const;

const REQUIRED_IN_PRODUCTION = [
  'KEYCLOAK_URL',
  'KEYCLOAK_REALM',
  'KEYCLOAK_CLIENT_ID',
  'KEYCLOAK_ADMIN_CLIENT_ID',
  'KEYCLOAK_ADMIN_CLIENT_SECRET',
  'KEYCLOAK_M2M_CLIENT_ID',
  'KEYCLOAK_M2M_CLIENT_SECRET',
  'KEYCLOAK_M2M_ALLOWED_CLIENTS',
  'KEYCLOAK_M2M_AUDIENCE',
  'EVENT_MANAGER_GRPC_URL',
  'EVENT_MANAGER_M2M_AUDIENCE',
  'ACCOUNT_MANAGER_GRPC_BIND_URL',
  'REDIS_HOST',
  'REDIS_PORT',
] as const;

export function validateStartupConfig(config: StartupConfig): StartupConfig {
  const environment = readEnvironment(config);
  const required =
    environment === 'production'
      ? [...REQUIRED_IN_ALL_ENVIRONMENTS, ...REQUIRED_IN_PRODUCTION]
      : REQUIRED_IN_ALL_ENVIRONMENTS;
  const missing = required.filter((name) => !readString(config, name));

  if (missing.length > 0) {
    throw new Error(`Startup configuration is incomplete for ${environment}: ${missing.join(', ')}`);
  }

  validateDatabaseUrl(readString(config, 'DATABASE_URL')!);
  validateUrl('BACKEND_URL', readString(config, 'BACKEND_URL')!);
  validateUrl('FRONTEND_URL', readString(config, 'FRONTEND_URL')!);
  validateUrl('S3_ENDPOINT', readString(config, 'S3_ENDPOINT')!);
  validatePort('PORT', config['PORT'], 3_000);
  validatePort('REDIS_PORT', config['REDIS_PORT'], 6_379);
  validateDiscordPair(config);
  validateJsonBackendList(config, 'ACCOUNT_MERGE_GRPC_BACKENDS', 'merge');
  validateJsonBackendList(config, 'LGPD_GRPC_BACKENDS', 'collect');
  validateJsonBackendList(config, 'LGPD_DELETION_GRPC_BACKENDS', 'delete');

  if (environment === 'production') {
    validateUrl('KEYCLOAK_URL', readString(config, 'KEYCLOAK_URL')!);
    if (readString(config, 'KEYCLOAK_TOKEN_ENDPOINT_AUTH_METHOD') === 'none') {
      // A public client is an explicit production choice; otherwise a client secret is mandatory.
    } else if (!readString(config, 'KEYCLOAK_CLIENT_SECRET')) {
      throw new Error('Startup configuration is incomplete for production: KEYCLOAK_CLIENT_SECRET');
    }

    validateProductionGrpcTls(config);
    requireBackendListOrExplicitOptOut(config, 'ACCOUNT_MERGE_GRPC_BACKENDS', 'ACCOUNT_MERGE_ALLOW_NO_BACKENDS');
    requireBackendListOrExplicitOptOut(config, 'LGPD_GRPC_BACKENDS', 'LGPD_ALLOW_NO_BACKENDS');
    requireBackendListOrExplicitOptOut(config, 'LGPD_DELETION_GRPC_BACKENDS', 'LGPD_DELETION_ALLOW_NO_BACKENDS');
  }

  return config;
}

function readEnvironment(config: StartupConfig): 'development' | 'test' | 'production' {
  const value = readString(config, 'NODE_ENV') ?? 'development';
  if (value === 'development' || value === 'test' || value === 'production') {
    return value;
  }

  throw new Error('NODE_ENV must be development, test, or production');
}

function readString(config: StartupConfig, name: string): string | undefined {
  const value = config[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function validateDatabaseUrl(value: string): void {
  if (!/^postgres(?:ql)?:\/\//i.test(value)) {
    throw new Error('DATABASE_URL must use the postgres or postgresql URL scheme');
  }
}

function validateUrl(name: string, value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be a valid absolute URL`);
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${name} must use http or https`);
  }
}

function validatePort(name: string, value: unknown, fallback: number): void {
  const candidate =
    value === undefined || value === ''
      ? String(fallback)
      : typeof value === 'string'
        ? value.trim()
        : typeof value === 'number' && Number.isFinite(value)
          ? String(value)
          : '';
  if (!/^\d+$/.test(candidate)) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }

  const port = Number(candidate);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} must be an integer between 1 and 65535`);
  }
}

function validateDiscordPair(config: StartupConfig): void {
  const hasToken = Boolean(readString(config, 'DISCORD_BOT_TOKEN'));
  const hasGuild = Boolean(readString(config, 'DISCORD_GUILD_ID'));
  if (hasToken !== hasGuild) {
    throw new Error('DISCORD_BOT_TOKEN and DISCORD_GUILD_ID must be configured together');
  }
}

function validateProductionGrpcTls(config: StartupConfig): void {
  const tlsValues = [
    readString(config, 'CACIC_GRPC_TLS_CA_CERT_PATH'),
    readString(config, 'CACIC_GRPC_TLS_CERT_PATH'),
    readString(config, 'CACIC_GRPC_TLS_KEY_PATH'),
  ];
  if (tlsValues.some((value) => !value)) {
    throw new Error(
      'Production gRPC startup requires CACIC_GRPC_TLS_CA_CERT_PATH, CACIC_GRPC_TLS_CERT_PATH, and CACIC_GRPC_TLS_KEY_PATH',
    );
  }
}

function validateJsonBackendList(config: StartupConfig, name: string, kind: 'merge' | 'collect' | 'delete'): void {
  const raw = readString(config, name);
  if (!raw) {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`${name} must be valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON array`);
  }

  parsed.forEach((item, index) => {
    if (
      !isRecord(item) ||
      typeof item['name'] !== 'string' ||
      !item['name'].trim() ||
      typeof item['target'] !== 'string' ||
      !item['target'].trim()
    ) {
      throw new Error(`${name}[${index}] must include non-empty name and target`);
    }

    if (kind === 'delete') {
      const actions = item['actions'];
      if (
        !Array.isArray(actions) ||
        actions.length === 0 ||
        actions.some((action) => !['schedule', 'cancel', 'delete'].includes(String(action)))
      ) {
        throw new Error(`${name}[${index}].actions must contain only schedule, cancel, or delete`);
      }
    }
  });

  const names = parsed.map((item) => (isRecord(item) ? String(item['name']) : ''));
  if (new Set(names).size !== names.length) {
    throw new Error(`${name} must not contain duplicate backend names`);
  }
}

function requireBackendListOrExplicitOptOut(config: StartupConfig, listName: string, optOutName: string): void {
  if (!readString(config, listName) && readString(config, optOutName) !== 'true') {
    throw new Error(`${listName} is required in production unless ${optOutName}=true`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
