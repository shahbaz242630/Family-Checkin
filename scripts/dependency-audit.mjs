#!/usr/bin/env node
// Production dependency audit gate. Runs `npm audit --omit=dev --json` and
// fails on any HIGH or CRITICAL advisory that is not listed, with a reason and
// an expiry date, in security/dependency-audit-allowlist.json.
//
// Why a script instead of `npm audit --audit-level=high`: the Expo SDK and
// Prisma toolchains carry known build-time advisories whose only fix is a
// major upgrade. Those are tracked as time-boxed exceptions instead of either
// turning the gate off or ignoring it when it is red. An expired entry fails
// the gate again, so every exception gets re-reviewed.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const SEVERITY_RANK = { info: 0, low: 1, moderate: 2, high: 3, critical: 4 };
export const ALLOWLIST_PATH = path.join('security', 'dependency-audit-allowlist.json');

/** Flatten npm's per-package report into one entry per advisory (GHSA id). */
export function collectAdvisories(auditJson) {
  const byId = new Map();
  for (const [pkg, vuln] of Object.entries(auditJson.vulnerabilities ?? {})) {
    for (const via of vuln.via ?? []) {
      if (typeof via !== 'object' || via === null || !via.url) continue;
      const id = String(via.url).split('/').pop();
      const existing = byId.get(id);
      if (existing) {
        existing.packages.add(pkg);
        continue;
      }
      byId.set(id, {
        id,
        url: via.url,
        severity: via.severity,
        title: via.title,
        packages: new Set([pkg]),
        fixAvailable: describeFix(vuln.fixAvailable),
      });
    }
  }
  return [...byId.values()]
    .map((a) => ({ ...a, packages: [...a.packages].sort() }))
    .sort((a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || a.id.localeCompare(b.id));
}

function describeFix(fix) {
  if (fix === true) return 'fix available';
  if (fix && typeof fix === 'object') return `${fix.name}@${fix.version}${fix.isSemVerMajor ? ' (major)' : ''}`;
  return 'no fix';
}

export function evaluate(advisories, allowlist, { now = new Date(), minSeverity = 'high' } = {}) {
  const minimum = SEVERITY_RANK[minSeverity];
  const entries = new Map((allowlist.entries ?? []).map((entry) => [entry.ghsa, entry]));
  const result = { failures: [], allowed: [], belowThreshold: [], unusedEntries: [] };

  for (const advisory of advisories) {
    if ((SEVERITY_RANK[advisory.severity] ?? 0) < minimum) {
      result.belowThreshold.push(advisory);
      continue;
    }
    const entry = entries.get(advisory.id);
    if (!entry) {
      result.failures.push({ ...advisory, reason: 'not in allowlist' });
      continue;
    }
    const problem = validateEntry(entry, now);
    if (problem) {
      result.failures.push({ ...advisory, reason: problem });
      continue;
    }
    result.allowed.push({ ...advisory, entry });
  }

  const seen = new Set(advisories.map((a) => a.id));
  result.unusedEntries = [...entries.values()].filter((entry) => !seen.has(entry.ghsa));
  return result;
}

function validateEntry(entry, now) {
  if (!entry.reason || String(entry.reason).trim().length < 20) return 'allowlist entry has no meaningful reason';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(entry.expires ?? ''))) return 'allowlist entry has no expiry (YYYY-MM-DD)';
  const expires = new Date(`${entry.expires}T23:59:59Z`);
  if (Number.isNaN(expires.getTime())) return 'allowlist entry expiry is not a valid date';
  if (expires < now) return `allowlist entry expired on ${entry.expires}`;
  return null;
}

export function runNpmAudit(cwd) {
  const result = spawnSync('npm audit --omit=dev --json', {
    cwd,
    encoding: 'utf8',
    shell: true,
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = (result.stdout ?? '').trim();
  if (!stdout) throw new Error(`npm audit produced no JSON output.\n${result.stderr ?? ''}`);
  const json = JSON.parse(stdout);
  if (json.error) throw new Error(`npm audit failed: ${json.error.summary ?? JSON.stringify(json.error)}`);
  return json;
}

export function loadAllowlist(cwd) {
  try {
    return JSON.parse(fs.readFileSync(path.join(cwd, ALLOWLIST_PATH), 'utf8'));
  } catch (error) {
    if (error && error.code === 'ENOENT') return { entries: [] };
    throw error;
  }
}

function main() {
  const cwd = process.cwd();
  const audit = runNpmAudit(cwd);
  const advisories = collectAdvisories(audit);
  const result = evaluate(advisories, loadAllowlist(cwd));

  const line = (a) => `${a.id} [${a.severity}] ${a.title} — ${a.packages.join(', ')} (${a.fixAvailable})`;
  console.log(
    `Production dependency audit: ${advisories.length} advisories, ${result.belowThreshold.length} below threshold.`,
  );
  if (result.allowed.length) {
    console.log(`\nAllowed by reviewed exception (${result.allowed.length}):`);
    for (const a of result.allowed) console.log(`  ${line(a)}\n    until ${a.entry.expires}: ${a.entry.reason}`);
  }
  if (result.unusedEntries.length) {
    console.log(`\nAllowlist entries no longer matching any advisory (remove them):`);
    for (const e of result.unusedEntries) console.log(`  ${e.ghsa}`);
  }
  if (result.failures.length) {
    console.error(`\nFAILED: ${result.failures.length} high/critical advisories need a fix or a reviewed exception:`);
    for (const a of result.failures) console.error(`  ${line(a)}\n    ${a.reason}; ${a.url}`);
    console.error(`\nAdd an entry to ${ALLOWLIST_PATH} only with a reason and an expiry date.`);
    return 1;
  }
  console.log('\nProduction dependency audit passed.');
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
