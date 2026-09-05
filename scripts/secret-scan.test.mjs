import { describe, expect, it } from 'vitest';
import { checkPath, listFiles, scanContent, scanFiles } from './secret-scan.mjs';

// Fixtures are assembled at runtime so no scanner (this one, gitleaks, or
// GitHub push protection) sees a secret-shaped literal in the repository.
const join = (...parts) => parts.join('');

describe('scanContent', () => {
  it('flags provider secret shapes with redacted output', () => {
    const contents = [
      'const a = 1;',
      `const aws = "${join('AKIA', 'IOSFODNN', '7EXAMPLE')}";`,
      `const stripe = "${join('sk_live_', 'abcdefghijklmnopqrstuvwxyz')}";`,
      `const sbp = "${join('sbp_', 'a'.repeat(40))}";`,
      `${join('-----BEGIN ', 'RSA PRIVATE KEY-----')}`,
    ].join('\n');
    const findings = scanContent('apps/backend/src/x.ts', contents);
    expect(findings.map((f) => [f.rule, f.line])).toEqual([
      ['private-key', 5],
      ['aws-access-key-id', 2],
      ['stripe-secret-key', 3],
      ['supabase-access-token', 4],
    ]);
    expect(findings[1].redacted).toBe('AKIAIO…(20 chars)');
    expect(findings[1].redacted).not.toContain('7EXAMPLE');
  });

  it('flags a Supabase service-role JWT but not an anon JWT', () => {
    const header = join('eyJ', 'hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    const serviceRole = join(header, '.', 'eyJ', 'InJvbGUiOiJzZXJ2aWNlX3JvbGUi', 'xyz', '.', 's'.repeat(20));
    const anon = join(header, '.', 'eyJ', 'InJvbGUiOiJhbm9uIi', 'xyz', '.', 's'.repeat(20));
    expect(scanContent('x.ts', serviceRole).map((f) => f.rule)).toEqual(['supabase-service-role-jwt']);
    expect(scanContent('x.ts', anon)).toEqual([]);
  });

  it('flags server-only variable names only inside the mobile app', () => {
    const line = 'const key = process.env.SUPABASE_SERVICE_ROLE_KEY;';
    expect(scanContent('apps/mobile/src/config.ts', line).map((f) => f.rule)).toEqual(['server-only-env-in-mobile']);
    expect(scanContent('apps/backend/src/config.ts', line)).toEqual([]);
  });

  it('ignores ordinary code and placeholder env examples', () => {
    const contents = [
      'SUPABASE_ANON_KEY="anon-key"',
      'EXPO_PUBLIC_REVENUECAT_IOS_API_KEY="appl_xxxxxxxxxxxxxxxxxxxxxxxx"',
      'const token = getBearerToken(request);',
    ].join('\n');
    expect(scanContent('apps/mobile/.env.example', contents)).toEqual([]);
  });
});

describe('checkPath', () => {
  it('rejects env files, key material, and credential dumps but allows .env.example', () => {
    expect(checkPath('apps/backend/.env').map((f) => f.rule)).toEqual(['dotenv-file']);
    expect(checkPath('apps/backend/.env.production').map((f) => f.rule)).toEqual(['dotenv-file']);
    expect(checkPath('apps/backend/.env.example')).toEqual([]);
    expect(checkPath('certs/server.pem').map((f) => f.rule)).toEqual(['key-material']);
    expect(checkPath('apps/mobile/google-services.json').map((f) => f.rule)).toEqual(['firebase-credentials']);
    expect(checkPath('Credentials.xlsx').map((f) => f.rule)).toEqual(['credential-spreadsheet']);
    expect(checkPath('apps/backend/src/main.ts')).toEqual([]);
  });
});

describe('scanFiles against this repository', () => {
  it('finds nothing in the tracked files', () => {
    const cwd = process.cwd();
    const files = listFiles(cwd);
    expect(files.length).toBeGreaterThan(50);
    expect(scanFiles(cwd, files)).toEqual([]);
  });
});
