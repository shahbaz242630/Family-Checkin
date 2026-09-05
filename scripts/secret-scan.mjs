#!/usr/bin/env node
// Lightweight secret scanner that needs nothing but Node. It complements
// gitleaks (CI + pre-push via Docker) so the pre-commit hook and CI both have
// a zero-dependency check that runs everywhere.
//
//   node scripts/secret-scan.mjs            scan every tracked file
//   node scripts/secret-scan.mjs --staged   scan files staged for commit
//
// Findings are redacted to the first 6 characters. Exit code 1 on any finding.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PATTERNS = [
  { name: 'private-key', regex: /-----BEGIN (?:[A-Z]+ )?PRIVATE KEY-----/ },
  { name: 'aws-access-key-id', regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: 'stripe-secret-key', regex: /\b[sr]k_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  { name: 'twilio-api-key-secret', regex: /\bSK[0-9a-f]{32}\b/ },
  {
    name: 'supabase-service-role-jwt',
    regex: /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]*InJvbGUiOiJzZXJ2aWNlX3JvbGUi[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{10,}/,
  },
  { name: 'supabase-access-token', regex: /\bsbp_[0-9a-f]{40}\b/ },
  { name: 'supabase-secret-key', regex: /\bsb_secret_[A-Za-z0-9_-]{20,}\b/ },
  { name: 'github-token', regex: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36}\b|\bgithub_pat_[A-Za-z0-9_]{22,}\b/ },
  { name: 'google-api-key', regex: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'slack-token', regex: /\bxox[abprs]-[0-9A-Za-z-]{10,}\b/ },
  { name: 'openai-key', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{32,}\b/ },
  {
    // The mobile app is shipped to users; server-only variable names in it
    // mean a server secret is about to be bundled.
    name: 'server-only-env-in-mobile',
    regex:
      /\b(?:SUPABASE_SERVICE_ROLE_KEY|KMS_MASTER_KEY_BASE64|TWILIO_AUTH_TOKEN|OPERATIONS_CRON_SECRET|CHANNEL_WEBHOOK_SECRET|REVENUECAT_WEBHOOK_AUTH_TOKEN|WHATSAPP_ACCESS_TOKEN|DATABASE_URL)\b/,
    onlyUnder: ['apps/mobile/'],
  },
];

/** Files that must never be committed regardless of content. */
export const FORBIDDEN_PATHS = [
  { name: 'dotenv-file', regex: /(^|\/)\.env(?!\.example$)(\.[^/]+)?$/ },
  { name: 'key-material', regex: /\.(pem|key|p12|pfx|jks|keystore|mobileprovision|p8)$/i },
  { name: 'firebase-credentials', regex: /(^|\/)(google-services\.json|GoogleService-Info\.plist)$/ },
  { name: 'service-account', regex: /(^|\/)(service-account[^/]*\.json|firebase-adminsdk[^/]*\.json)$/i },
  { name: 'credential-spreadsheet', regex: /credentials?[^/]*\.(xlsx|xls|csv)$/i },
];

const SKIP_PATHS = [
  /^package-lock\.json$/,
  /^scripts\/secret-scan(\.test)?\.mjs$/,
  /^\.gitleaks\.toml$/,
  /\.(png|jpg|jpeg|gif|ico|wav|mp3|ttf|otf|woff2?|jar|zip)$/i,
];

const MAX_BYTES = 2 * 1024 * 1024;

export function scanContent(relativePath, contents) {
  const findings = [];
  const lines = contents.split(/\r?\n/);
  for (const pattern of PATTERNS) {
    if (pattern.onlyUnder && !pattern.onlyUnder.some((prefix) => relativePath.startsWith(prefix))) continue;
    lines.forEach((line, index) => {
      const match = line.match(pattern.regex);
      if (match) findings.push({ rule: pattern.name, path: relativePath, line: index + 1, redacted: redact(match[0]) });
    });
  }
  return findings;
}

export function checkPath(relativePath) {
  return FORBIDDEN_PATHS.filter((rule) => rule.regex.test(relativePath)).map((rule) => ({
    rule: rule.name,
    path: relativePath,
    line: 0,
    redacted: '(file must not be committed)',
  }));
}

function redact(value) {
  return `${value.slice(0, 6)}…(${value.length} chars)`;
}

export function listFiles(cwd, { staged = false } = {}) {
  const args = staged
    ? ['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR']
    : ['ls-files', '-z', '--cached', '--others', '--exclude-standard'];
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout.split('\0').filter(Boolean);
}

export function scanFiles(cwd, files) {
  const findings = [];
  for (const relativePath of files) {
    const normalised = relativePath.replace(/\\/g, '/');
    findings.push(...checkPath(normalised));
    if (SKIP_PATHS.some((pattern) => pattern.test(normalised))) continue;
    const absolute = path.join(cwd, normalised);
    if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
    if (fs.statSync(absolute).size > MAX_BYTES) continue;
    const buffer = fs.readFileSync(absolute);
    if (buffer.subarray(0, 8192).includes(0)) continue; // binary
    findings.push(...scanContent(normalised, buffer.toString('utf8')));
  }
  return findings;
}

function main(argv) {
  const staged = argv.includes('--staged');
  const cwd = process.cwd();
  const files = listFiles(cwd, { staged });
  const findings = scanFiles(cwd, files);
  const scope = staged ? 'staged' : 'tracked';
  if (findings.length === 0) {
    console.log(`Secret scan passed (${files.length} ${scope} file(s)).`);
    return 0;
  }
  console.error(`Secret scan failed with ${findings.length} finding(s) across ${files.length} ${scope} file(s):`);
  for (const f of findings) console.error(`- [${f.rule}] ${f.path}${f.line ? `:${f.line}` : ''} ${f.redacted}`);
  console.error('\nRemove the value (rotate it if it was ever real), or unstage the file.');
  return 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
