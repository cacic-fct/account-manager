import { spawnSync } from 'node:child_process';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

const rootDir = fileURLToPath(new URL('..', import.meta.url));
const composeFile = 'docker/docker-compose.seaweedfs.test.yml';
const seaweedfsPort = process.env.SEAWEEDFS_S3_TEST_PORT || '18333';
const seaweedfsHost = '127.0.0.1';
const seaweedfsEndpoint = `http://localhost:${seaweedfsPort}`;
const keepContainer = process.env.SEAWEEDFS_TEST_KEEPALIVE === 'true';
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

function dockerCompose(args) {
  run('docker', ['compose', '-f', composeFile, ...args]);
}

async function waitForTcp(host, port, label, timeoutMs = 120_000) {
  const timeoutAt = Date.now() + timeoutMs;
  let lastError;

  while (Date.now() < timeoutAt) {
    try {
      await new Promise((resolve, reject) => {
        const socket = net.createConnection({ host, port: Number(port) });
        socket.setTimeout(2_000);
        socket.once('connect', () => {
          socket.end();
          resolve();
        });
        socket.once('timeout', () => {
          socket.destroy(new Error('TCP connection timed out'));
        });
        socket.once('error', reject);
      });
      return;
    } catch (error) {
      lastError = error;
    }

    await delay(1_000);
  }

  throw new Error(
    `Timed out waiting for ${label} at ${host}:${port}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

function buildTestEnv() {
  return {
    ...process.env,
    NODE_ENV: 'test',
    S3_INTEGRATION_TEST: 'true',
    S3_ENDPOINT: seaweedfsEndpoint,
    S3_ACCESS_KEY: 'test-access-key',
    S3_SECRET_KEY: 'test-secret-key',
    S3_BUCKET_NAME: 'account-manager-integration-test',
    S3_REGION: 'us-east-1',
  };
}

async function main() {
  const testEnv = buildTestEnv();
  const jestArgs = [
    'run',
    'jest',
    '--config',
    './test/jest-seaweedfs-integration.json',
    '--runInBand',
  ];

  if (collectCoverage) {
    jestArgs.push(
      '--coverage',
      '--coverageDirectory',
      '../../coverage/apps/account-backend-seaweedfs-integration',
      '--coverageReporters=json',
      '--coverageReporters=lcov',
      '--coverageReporters=clover',
    );
  }

  dockerCompose(['down', '-v', '--remove-orphans']);
  dockerCompose(['up', '-d']);

  await waitForTcp(seaweedfsHost, seaweedfsPort, 'test SeaweedFS S3 API');

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
