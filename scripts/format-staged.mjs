#!/usr/bin/env node
// Pre-commit helper: runs Prettier on the staged files it understands and
// re-stages them. Keeps new and touched code formatted without reformatting
// the whole repository in one commit.
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const FORMATTABLE = /\.(ts|tsx|js|jsx|mjs|cjs|json|ya?ml)$/i;

function git(args) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

const staged = git(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'])
  .split('\0')
  .filter((file) => file && FORMATTABLE.test(file));

if (staged.length === 0) {
  process.exit(0);
}

const prettier = path.join('node_modules', '.bin', process.platform === 'win32' ? 'prettier.cmd' : 'prettier');
const result = spawnSync(prettier, ['--write', '--ignore-unknown', ...staged], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (result.status !== 0) {
  console.error('format-staged: prettier failed; fix the file(s) above and commit again.');
  process.exit(result.status ?? 1);
}
git(['add', '--', ...staged]);
