import { describe, expect, it } from 'vitest';
import { checkWorkflow, collectJobs, runCheck } from './github-actions-security-check.mjs';

const SHA = 'a'.repeat(40);

const goodWorkflow = `name: CI
on:
  pull_request:
  push:
    branches: [master]
permissions:
  contents: read
jobs:
  verify:
    runs-on: ubuntu-latest
    timeout-minutes: 10
    steps:
      - uses: actions/checkout@${SHA} # v7.0.1
        with:
          persist-credentials: false
      - uses: gitleaks/gitleaks-action@${SHA} # v3.0.0
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
`;

const rules = (violations) => violations.map((v) => v.rule).sort();

describe('checkWorkflow', () => {
  it('accepts a pinned, read-only, timed workflow', () => {
    expect(checkWorkflow('ci.yml', goodWorkflow)).toEqual([]);
  });

  it('accepts permissions: {}', () => {
    const wf = goodWorkflow.replace('permissions:\n  contents: read', 'permissions: {}');
    expect(checkWorkflow('ci.yml', wf)).toEqual([]);
  });

  it('rejects pull_request_target', () => {
    const wf = goodWorkflow.replace('pull_request:', 'pull_request_target:');
    expect(rules(checkWorkflow('ci.yml', wf))).toContain('no-pull-request-target');
  });

  it('rejects write-all and missing top-level permissions', () => {
    expect(rules(checkWorkflow('a.yml', goodWorkflow.replace('  contents: read', '  contents: write')))).toContain(
      'minimal-permissions',
    );
    expect(
      rules(checkWorkflow('a.yml', goodWorkflow.replace('permissions:\n  contents: read', 'permissions: write-all'))),
    ).toEqual(expect.arrayContaining(['no-write-all', 'minimal-permissions']));
  });

  it('rejects tag-pinned and unlisted actions', () => {
    const wf = goodWorkflow
      .replace(`actions/checkout@${SHA}`, 'actions/checkout@v4')
      .replace(`gitleaks/gitleaks-action@${SHA}`, `evil/action@${SHA}`);
    const found = checkWorkflow('a.yml', wf);
    expect(rules(found)).toEqual(expect.arrayContaining(['pinned-actions', 'allowed-actions']));
    expect(found.find((v) => v.rule === 'allowed-actions').action).toBe(`evil/action@${SHA}`);
  });

  it('rejects repository secrets on pull_request workflows but allows GITHUB_TOKEN', () => {
    const wf = goodWorkflow.replace('secrets.GITHUB_TOKEN', 'secrets.DEPLOY_KEY');
    expect(rules(checkWorkflow('a.yml', wf))).toContain('no-secrets-on-pull-request');
    expect(rules(checkWorkflow('a.yml', goodWorkflow))).not.toContain('no-secrets-on-pull-request');
  });

  it('allows repository secrets when the workflow is not PR-triggered', () => {
    const wf = goodWorkflow.replace('  pull_request:\n', '').replace('secrets.GITHUB_TOKEN', 'secrets.CRON_SECRET');
    expect(rules(checkWorkflow('a.yml', wf))).not.toContain('no-secrets-on-pull-request');
  });

  it('requires timeout-minutes on every job', () => {
    const wf = goodWorkflow.replace('    timeout-minutes: 10\n', '');
    const found = checkWorkflow('a.yml', wf);
    expect(rules(found)).toContain('job-timeout');
    expect(found.find((v) => v.rule === 'job-timeout').message).toContain('"verify"');
  });
});

describe('collectJobs', () => {
  it('splits the jobs section by job name', () => {
    const jobs = collectJobs(`${goodWorkflow}  security:\n    runs-on: ubuntu-latest\n`);
    expect(jobs.map((j) => j.name)).toEqual(['verify', 'security']);
    expect(jobs[0].block).toContain('timeout-minutes: 10');
    expect(jobs[1].block).not.toContain('timeout-minutes');
  });
});

describe('runCheck against this repository', () => {
  it('passes for the committed workflows', () => {
    const result = runCheck();
    expect(result.files.length).toBeGreaterThan(0);
    expect(result.violations).toEqual([]);
  });
});
