import { describe, expect, it } from 'vitest';
import { collectAdvisories, evaluate } from './dependency-audit.mjs';

const advisory = (id, severity, extra = {}) => ({
  source: 1,
  name: 'pkg',
  dependency: 'pkg',
  title: `Problem ${id}`,
  url: `https://github.com/advisories/${id}`,
  severity,
  range: '<1',
  ...extra,
});

const auditJson = {
  vulnerabilities: {
    postcss: {
      name: 'postcss',
      severity: 'high',
      isDirect: false,
      via: [advisory('GHSA-aaaa-1111-2222', 'high'), advisory('GHSA-bbbb-3333-4444', 'moderate')],
      fixAvailable: { name: 'expo', version: '57.0.0', isSemVerMajor: true },
    },
    metro: {
      name: 'metro',
      severity: 'high',
      isDirect: false,
      via: ['postcss', advisory('GHSA-aaaa-1111-2222', 'high')],
      fixAvailable: true,
    },
    ws: {
      name: 'ws',
      severity: 'critical',
      isDirect: false,
      via: [advisory('GHSA-cccc-5555-6666', 'critical')],
      fixAvailable: false,
    },
  },
};

describe('collectAdvisories', () => {
  it('dedupes advisories across packages and describes the fix', () => {
    const advisories = collectAdvisories(auditJson);
    expect(advisories.map((a) => a.id)).toEqual(['GHSA-cccc-5555-6666', 'GHSA-aaaa-1111-2222', 'GHSA-bbbb-3333-4444']);
    const shared = advisories.find((a) => a.id === 'GHSA-aaaa-1111-2222');
    expect(shared.packages).toEqual(['metro', 'postcss']);
    expect(shared.fixAvailable).toBe('expo@57.0.0 (major)');
    expect(advisories.find((a) => a.id === 'GHSA-cccc-5555-6666').fixAvailable).toBe('no fix');
  });

  it('handles an empty report', () => {
    expect(collectAdvisories({})).toEqual([]);
  });
});

describe('evaluate', () => {
  const now = new Date('2026-09-05T12:00:00Z');
  const advisories = collectAdvisories(auditJson);

  it('fails on high/critical advisories without an exception and ignores lower severities', () => {
    const result = evaluate(advisories, { entries: [] }, { now });
    expect(result.failures.map((f) => f.id)).toEqual(['GHSA-cccc-5555-6666', 'GHSA-aaaa-1111-2222']);
    expect(result.belowThreshold.map((a) => a.id)).toEqual(['GHSA-bbbb-3333-4444']);
  });

  it('allows advisories with an unexpired, justified exception', () => {
    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-aaaa-1111-2222',
          reason: 'Build-time only; fixed by the Expo SDK 57 upgrade.',
          expires: '2026-12-31',
        },
        {
          ghsa: 'GHSA-cccc-5555-6666',
          reason: 'Not reachable: server never accepts websocket upgrades.',
          expires: '2026-12-31',
        },
      ],
    };
    const result = evaluate(advisories, allowlist, { now });
    expect(result.failures).toEqual([]);
    expect(result.allowed.map((a) => a.id).sort()).toEqual(['GHSA-aaaa-1111-2222', 'GHSA-cccc-5555-6666']);
  });

  it('fails again when an exception has expired or lacks a reason', () => {
    const allowlist = {
      entries: [
        {
          ghsa: 'GHSA-aaaa-1111-2222',
          reason: 'Build-time only; fixed by the Expo SDK 57 upgrade.',
          expires: '2026-09-01',
        },
        { ghsa: 'GHSA-cccc-5555-6666', reason: 'meh', expires: '2026-12-31' },
      ],
    };
    const result = evaluate(advisories, allowlist, { now });
    expect(result.failures.map((f) => [f.id, f.reason])).toEqual([
      ['GHSA-cccc-5555-6666', 'allowlist entry has no meaningful reason'],
      ['GHSA-aaaa-1111-2222', 'allowlist entry expired on 2026-09-01'],
    ]);
  });

  it('reports allowlist entries that no longer match anything', () => {
    const allowlist = {
      entries: [
        { ghsa: 'GHSA-zzzz-0000-0000', reason: 'Historic entry that should be removed now.', expires: '2027-01-01' },
      ],
    };
    expect(evaluate(advisories, allowlist, { now }).unusedEntries.map((e) => e.ghsa)).toEqual(['GHSA-zzzz-0000-0000']);
  });
});

describe('dependency-review workflow allowlist', () => {
  it('matches security/dependency-audit-allowlist.json exactly', async () => {
    const fs = await import('node:fs');
    const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
    const match = ci.match(/allow-ghsas:s*(.+)/);
    expect(match, 'ci.yml must configure allow-ghsas on the dependency-review step').not.toBeNull();
    const fromWorkflow = match[1]
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean)
      .sort();
    const fromAllowlist = JSON.parse(fs.readFileSync('security/dependency-audit-allowlist.json', 'utf8'))
      .entries.map((entry) => entry.ghsa)
      .sort();
    expect(fromWorkflow).toEqual(fromAllowlist);
  });
});
