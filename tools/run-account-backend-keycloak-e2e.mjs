import { spawnSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const composeFile = 'docker/docker-compose.keycloak.test.yml';
const keycloakPort = process.env.KEYCLOAK_TEST_PORT || '18080';
const keycloakUrl = `http://localhost:${keycloakPort}`;
const backendUrl = process.env.BACKEND_URL || 'http://localhost:3000';
const frontendUrl = process.env.FRONTEND_URL || 'http://localhost:4200/app/';
const keepContainer = process.env.KEYCLOAK_TEST_KEEPALIVE === 'true';
const collectCoverage =
  process.argv.includes('--coverage') || process.env.COLLECT_COVERAGE === 'true';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    ...options,
  });

  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited with status ${result.status}`,
    );
  }
}

async function waitForUrl(url, label, timeoutMs = 120_000) {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < timeoutAt) {
    try {
      const response = await fetch(url, {
        redirect: 'manual',
      });
      if (response.ok) {
        return;
      }

      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  throw new Error(
    `Timed out waiting for ${label} at ${url}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function dockerCompose(args) {
  run('docker', ['compose', '-f', composeFile, ...args]);
}

function buildTestEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    KEYCLOAK_URL: keycloakUrl,
    KEYCLOAK_REALM: 'cacic-sso',
    KEYCLOAK_CLIENT_ID: 'cacic-account-manager',
    KEYCLOAK_CLIENT_SECRET: 'cacic-account-manager-dev-secret',
    KEYCLOAK_ADMIN_CLIENT_ID: 'cacic-account-manager-admin-client',
    KEYCLOAK_ADMIN_CLIENT_SECRET:
      'cacic-account-manager-admin-client-dev-secret',
    KEYCLOAK_M2M_CLIENT_ID: 'cacic-account-manager-m2m',
    KEYCLOAK_M2M_CLIENT_SECRET: 'cacic-account-manager-m2m-dev-secret',
    KEYCLOAK_M2M_AUDIENCE: 'cacic-account-manager-audience',
    KEYCLOAK_M2M_ALLOWED_CLIENTS: 'cacic-event-manager-m2m',
    KEYCLOAK_M2M_REQUIRE_SERVICE_ACCOUNT: 'true',
    KEYCLOAK_PASSWORD_LOGIN_ENABLED: 'true',
    BACKEND_URL: backendUrl,
    FRONTEND_URL: frontendUrl,
    SESSION_SECRET: 'test-session-secret',
    ALLOWED_REDIRECT_URLS: frontendUrl,
  };
}

async function main() {
  const testEnv = buildTestEnv();
  const jestArgs = [
    'run',
    'jest',
    '--config',
    './test/jest-keycloak-e2e.json',
    '--runInBand',
  ];

  if (collectCoverage) {
    jestArgs.push(
      '--coverage',
      '--coverageDirectory',
      '../../coverage/apps/account-backend-keycloak-e2e',
      '--coverageReporters=json',
      '--coverageReporters=lcov',
      '--coverageReporters=clover',
    );
  }

  dockerCompose(['down', '-v', '--remove-orphans']);
  dockerCompose(['up', '-d']);

  await waitForUrl(
    `${keycloakUrl}/realms/cacic-sso/.well-known/openid-configuration`,
    'test Keycloak',
  );

  run(
    process.platform === 'win32' ? 'bun.cmd' : 'bun',
    jestArgs,
    {
      cwd: `${rootDir}/apps/account-backend`,
      env: testEnv,
    },
  );
}

try {
  await main();
} finally {
  if (!keepContainer) {
    dockerCompose(['down', '-v', '--remove-orphans']);
  }
}
