import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const [, , packageDirArg, packageKey] = process.argv;

const packages = {
  'm2m-contracts': {
    name: '@cacic-fct/account-manager-m2m-contracts',
    requiredFiles: [
      'index.js', 'index.d.ts', 'lib/m2m-contracts.js', 'lib/m2m-contracts.d.ts',
      'cjs/package.json', 'cjs/index.js', 'cjs/index.d.ts',
      'cjs/lib/m2m-contracts.js', 'cjs/lib/m2m-contracts.d.ts',
    ],
  },
  'account-privacy': {
    name: '@cacic-fct/account-manager-privacy',
    requiredFiles: [
      'index.js',
      'index.d.ts',
      'lib/account-privacy.config.js',
      'lib/account-privacy.config.d.ts',
      'lib/account-privacy.service.js',
      'lib/account-privacy.service.d.ts',
      'lib/account-privacy.types.js',
      'lib/account-privacy.types.d.ts',
      'lib/umami-tracking.js',
      'lib/umami-tracking.d.ts',
    ],
  },
  'cookie-banner': {
    name: '@cacic-fct/account-manager-cookie-banner',
    requiredFiles: [
      'index.js',
      'index.d.ts',
      'angular/index.js',
      'angular/index.d.ts',
      'angular/cookie-banner.component.js',
      'angular/cookie-banner.component.d.ts',
      'lib/cookie-banner.js',
      'lib/cookie-banner.d.ts',
      'lib/cookie-banner.css',
    ],
  },
};

const forbiddenFiles = [
  'project.json',
  'tsconfig.json',
  'tsconfig.lib.json',
  'eslint.config.mjs',
  'jest.config.ts',
  'src/index.ts',
];

if (!packageDirArg || !packageKey || !packages[packageKey]) {
  const keys = Object.keys(packages).join(', ');
  throw new Error(`Usage: bun tools/verify-package-artifact.mjs <package-dir> <${keys}>`);
}

const packageDir = resolve(packageDirArg);
const expected = packages[packageKey];
const packageJsonPath = join(packageDir, 'package.json');

if (!existsSync(packageJsonPath)) {
  throw new Error(`Missing package.json in ${packageDir}`);
}

const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8'));

if (packageJson.name !== expected.name) {
  throw new Error(`Expected package ${expected.name}, found ${packageJson.name}`);
}

if (packageJson.publishConfig?.registry !== 'https://registry.npmjs.org') {
  throw new Error(`Package must publish to npm. Found: ${packageJson.publishConfig?.registry}`);
}

if (packageJson.publishConfig?.access !== 'public') {
  throw new Error(`Package must publish publicly. Found: ${packageJson.publishConfig?.access}`);
}

const missingFiles = expected.requiredFiles.filter((file) => !existsSync(join(packageDir, file)));
if (missingFiles.length > 0) {
  throw new Error(`Package artifact is missing required files: ${missingFiles.join(', ')}`);
}

const presentForbiddenFiles = forbiddenFiles.filter((file) => existsSync(join(packageDir, file)));
if (presentForbiddenFiles.length > 0) {
  throw new Error(`Package artifact contains source/project files: ${presentForbiddenFiles.join(', ')}`);
}

if (packageKey === 'm2m-contracts') {
  const result = spawnSync('node', ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { readFileSync } from 'node:fs';
    const name = ${JSON.stringify(expected.name)};
    const esm = await import(name);
    const require = createRequire(import.meta.url);
    const cjs = require(name);
    assert.ok(require.resolve(name).endsWith('/cjs/index.js'));
    assert.equal(JSON.parse(readFileSync('./package.json', 'utf8')).type, 'module');
    assert.deepEqual(Object.keys(esm).sort(), Object.keys(cjs).sort());
    for (const key of Object.keys(esm)) {
      if (typeof esm[key] === 'function') {
        assert.equal(typeof cjs[key], 'function');
      } else {
        assert.deepEqual(esm[key], cjs[key]);
      }
    }
    assert.deepEqual(esm.createDefaultPrivacySettings(), cjs.createDefaultPrivacySettings());
    assert.equal(typeof esm.CACIC_TRACKING_ROUTES.session, 'string');
    assert.ok(readFileSync(require.resolve(name + '/proto/cacic/m2m/account_manager/v1.proto'), 'utf8').includes('AccountManagerM2M'));
  `], { cwd: packageDir, encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    throw new Error(`Node ESM/CommonJS verification failed: ${result.error ?? result.stderr}`);
  }
}

console.log(`Verified ${packageJson.name}@${packageJson.version} in ${packageDir}`);
