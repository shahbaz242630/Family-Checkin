#!/usr/bin/env node
// Runs gitleaks against the whole repository (working tree + history) using
// the pinned Docker image, so the pre-push hook matches what CI runs. Skips
// with a notice when Docker is unavailable; CI remains the hard gate.
//   node scripts/gitleaks-local.mjs
import { spawnSync } from 'node:child_process';

const IMAGE = 'zricethezav/gitleaks:v8.24.3';

const docker = spawnSync('docker', ['info'], { encoding: 'utf8' });
if (docker.error || docker.status !== 0) {
  console.log('gitleaks-local: Docker is not available; skipping local secrets scan (CI still runs it).');
  process.exit(0);
}

const cwd = process.cwd();
const result = spawnSync(
  'docker',
  [
    'run',
    '--rm',
    '-v',
    `${cwd}:/repo`,
    IMAGE,
    'detect',
    '--source',
    '/repo',
    '--config',
    '/repo/.gitleaks.toml',
    '--redact',
    '--no-banner',
    '--exit-code',
    '2',
  ],
  { stdio: 'inherit' },
);

if (result.status === 2) {
  console.error('gitleaks-local: leaks found. Remove/rotate the secret before pushing.');
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`gitleaks-local: gitleaks exited with status ${result.status}; refusing to push without a clean scan.`);
  process.exit(1);
}
console.log('gitleaks-local: no leaks found.');
