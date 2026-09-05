#!/usr/bin/env node
// Installs the repository's git hooks. Runs automatically from the root
// `prepare` script (every `npm install`), and can be run by hand:
//   node scripts/install-hooks.mjs
//
// Hooks are plain POSIX sh so they work from Git Bash on Windows, macOS, and
// Linux. Each written file carries a marker line; a hook without the marker
// (someone's hand-written hook) is left alone.
//
//   pre-commit  secret scan of staged files, Prettier on staged files
//   pre-push    gitleaks (Docker, skipped with a notice if Docker is absent),
//               lint, typecheck
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const MARKER = '# managed-by: scripts/install-hooks.mjs';

const HOOKS = {
  'pre-commit': `#!/bin/sh
${MARKER}
set -e
node scripts/secret-scan.mjs --staged
node scripts/format-staged.mjs
`,
  'pre-push': `#!/bin/sh
${MARKER}
set -e
node scripts/gitleaks-local.mjs
npm run lint
npm run typecheck
`,
};

function hooksDirectory() {
  const result = spawnSync('git', ['rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' });
  if (result.status !== 0) return null;
  return path.resolve(result.stdout.trim());
}

function readIfPresent(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error && error.code === 'ENOENT') return null;
    throw error;
  }
}

function main() {
  if (process.env.CI) {
    console.log('install-hooks: CI detected, skipping.');
    return 0;
  }
  const directory = hooksDirectory();
  if (!directory) {
    console.log('install-hooks: not a git repository, skipping.');
    return 0;
  }
  fs.mkdirSync(directory, { recursive: true });

  for (const [name, contents] of Object.entries(HOOKS)) {
    const file = path.join(directory, name);
    const existing = readIfPresent(file);
    if (existing !== null && !existing.includes(MARKER)) {
      console.log(`install-hooks: ${name} exists and is not managed here; leaving it alone.`);
      continue;
    }
    fs.writeFileSync(file, contents, { mode: 0o755 });
    try {
      fs.chmodSync(file, 0o755);
    } catch {
      // Windows ignores the executable bit; git runs hooks through sh anyway.
    }
    console.log(`install-hooks: wrote ${path.relative(process.cwd(), file)}`);
  }
  return 0;
}

process.exit(main());
