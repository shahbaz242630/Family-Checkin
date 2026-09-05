#!/usr/bin/env node
// Workflow hygiene gate for .github/workflows/*.yml. Runs in CI ("Security
// scans" job) and via `npm run security:workflows`.
//
// A workflow fails this check when it:
//   - uses `pull_request_target` (runs trusted context against untrusted code)
//   - grants `permissions: write-all`, or omits a top-level `permissions:`
//     block with `contents: read` (or `permissions: {}`)
//   - uses an action that is not pinned to a full 40-character commit SHA
//   - uses an action outside ALLOWED_ACTIONS (add to the list deliberately)
//   - is triggered by `pull_request` and references any repository secret
//     other than the ephemeral GITHUB_TOKEN
//   - has a job without `timeout-minutes`
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ALLOWED_ACTIONS = new Set([
  'actions/checkout',
  'actions/setup-node',
  'actions/upload-artifact',
  'actions/download-artifact',
  'actions/dependency-review-action',
  'github/codeql-action/init',
  'github/codeql-action/analyze',
  'gitleaks/gitleaks-action',
  'zizmorcore/zizmor-action',
  'aquasecurity/trivy-action',
  'supabase/setup-cli',
]);

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export function checkWorkflow(relativePath, contents) {
  const violations = [];
  const add = (rule, message, extra = {}) => violations.push({ rule, message, path: relativePath, ...extra });

  if (/^\s*pull_request_target\s*:/m.test(contents)) {
    add('no-pull-request-target', 'pull_request_target exposes trusted context to untrusted PR code.');
  }

  if (/^\s*permissions\s*:\s*write-all\s*$/m.test(contents)) {
    add('no-write-all', 'permissions: write-all is never acceptable.');
  }

  if (!hasMinimalTopLevelPermissions(contents)) {
    add(
      'minimal-permissions',
      'Declare a top-level `permissions:` block with `contents: read` (or `permissions: {}`).',
    );
  }

  for (const match of contents.matchAll(/^\s*-?\s*uses\s*:\s*['"]?([^\s'"#]+)['"]?/gm)) {
    const ref = match[1];
    if (ref.startsWith('./')) continue; // local composite action
    const at = ref.lastIndexOf('@');
    const name = at >= 0 ? ref.slice(0, at) : ref;
    const version = at >= 0 ? ref.slice(at + 1) : '';

    if (!SHA_PATTERN.test(version)) {
      add('pinned-actions', `${ref} must be pinned to a full 40-character commit SHA (with a "# vX" comment).`, {
        action: ref,
      });
    }
    if (!ALLOWED_ACTIONS.has(name)) {
      add('allowed-actions', `${name} is not in the reviewed action allowlist.`, { action: ref });
    }
  }

  if (/^\s*pull_request\s*:/m.test(contents)) {
    for (const match of contents.matchAll(/\$\{\{\s*secrets\.([A-Za-z0-9_]+)/g)) {
      if (match[1] === 'GITHUB_TOKEN') continue;
      add('no-secrets-on-pull-request', `secrets.${match[1]} is referenced in a workflow that runs on pull_request.`);
    }
  }

  for (const job of collectJobs(contents)) {
    if (!/^\s+timeout-minutes\s*:\s*\d+/m.test(job.block)) {
      add('job-timeout', `Job "${job.name}" has no timeout-minutes.`);
    }
  }

  return violations;
}

function hasMinimalTopLevelPermissions(contents) {
  if (/^permissions\s*:\s*\{\s*\}\s*$/m.test(contents)) return true;
  const block = contents.match(/^permissions\s*:\s*\r?\n((?:[ \t]+\S.*\r?\n?)+)/m);
  if (!block) return false;
  return /^[ \t]+contents\s*:\s*read\s*$/m.test(block[1]);
}

export function collectJobs(contents) {
  const jobsStart = contents.search(/^jobs\s*:\s*$/m);
  if (jobsStart < 0) return [];
  // The jobs section ends at the next column-0 key (rare, but legal YAML).
  const rest = contents.slice(jobsStart).split(/\r?\n/).slice(1);
  const lines = [];
  for (const line of rest) {
    if (/^\S/.test(line)) break;
    lines.push(line);
  }
  const jobs = [];
  for (const line of lines) {
    const header = line.match(/^  ([A-Za-z0-9_-]+)\s*:\s*$/);
    if (header) {
      jobs.push({ name: header[1], lines: [] });
    } else if (jobs.length > 0) {
      jobs[jobs.length - 1].lines.push(line);
    }
  }
  return jobs.map((job) => ({ name: job.name, block: job.lines.join('\n') }));
}

export function runCheck({ cwd = process.cwd(), workflowDir = path.join('.github', 'workflows') } = {}) {
  const absoluteDir = path.join(cwd, workflowDir);
  if (!fs.existsSync(absoluteDir)) return { ok: true, violations: [], files: [] };

  const files = fs
    .readdirSync(absoluteDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.ya?ml$/i.test(entry.name))
    .map((entry) => path.join(absoluteDir, entry.name))
    .sort();

  const violations = files.flatMap((file) =>
    checkWorkflow(path.relative(cwd, file).replace(/\\/g, '/'), fs.readFileSync(file, 'utf8')),
  );

  return { ok: violations.length === 0, violations, files: files.map((f) => path.relative(cwd, f)) };
}

function main() {
  const result = runCheck();
  if (result.ok) {
    console.log(`GitHub Actions security check passed (${result.files.length} workflow file(s)).`);
    return 0;
  }
  console.error('GitHub Actions security check failed:');
  for (const v of result.violations) {
    console.error(`- [${v.rule}] ${v.path}: ${v.message}`);
  }
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
