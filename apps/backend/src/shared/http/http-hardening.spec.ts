import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';
import { describe, expect, it } from 'vitest';
import { AppConfigService } from '../config/app-config.service';
import { corsOptionsFromConfig, isOriginAllowed, throttlerOptionsFromConfig } from './http-hardening';

function validEnv(overrides: Record<string, string | undefined> = {}) {
  return {
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
    KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    SUPABASE_URL: 'https://nearby-test-project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    OPERATIONS_CRON_SECRET: 'operations-cron-secret',
    ...overrides,
  };
}

interface OriginDecision {
  error: Error | null;
  allowed: boolean;
}

// The cors origin callback is synchronous, so the decision can be captured directly.
function decideOrigin(options: CorsOptions, origin: string | undefined): OriginDecision {
  const originOption = options.origin;
  if (typeof originOption !== 'function') {
    throw new Error('expected a custom origin function');
  }

  let decision: OriginDecision = { error: new Error('callback not invoked'), allowed: false };
  // Nest types the request origin as string, but the cors middleware passes undefined
  // when the request carries no Origin header.
  originOption(origin as string, (error, allow) => {
    decision = { error, allowed: allow === true };
  });

  return decision;
}

describe('throttlerOptionsFromConfig', () => {
  it('builds one default throttler from the config defaults (ttl in milliseconds)', () => {
    const options = throttlerOptionsFromConfig(new AppConfigService(validEnv()));

    expect(options).toEqual({ throttlers: [{ name: 'default', ttl: 60_000, limit: 300 }] });
  });

  it('uses the configured ttl and limit', () => {
    const options = throttlerOptionsFromConfig(
      new AppConfigService(validEnv({ RATE_LIMIT_TTL_SECONDS: '15', RATE_LIMIT_MAX_REQUESTS: '7' })),
    );

    expect(options).toEqual({ throttlers: [{ name: 'default', ttl: 15_000, limit: 7 }] });
  });
});

describe('corsOptionsFromConfig', () => {
  const options = corsOptionsFromConfig(
    new AppConfigService(validEnv({ CORS_ALLOWED_ORIGINS: 'https://admin.nearby.test, https://app.nearby.test' })),
  );

  it('sends credentials', () => {
    expect(options.credentials).toBe(true);
  });

  it('allows requests without an Origin header (native app)', () => {
    expect(decideOrigin(options, undefined)).toEqual({ error: null, allowed: true });
  });

  it('allows local development origins on 80xx ports', () => {
    expect(decideOrigin(options, 'http://localhost:8081')).toEqual({ error: null, allowed: true });
    expect(decideOrigin(options, 'http://127.0.0.1:8082')).toEqual({ error: null, allowed: true });
  });

  it('allows origins listed in CORS_ALLOWED_ORIGINS', () => {
    expect(decideOrigin(options, 'https://admin.nearby.test')).toEqual({ error: null, allowed: true });
    expect(decideOrigin(options, 'https://app.nearby.test')).toEqual({ error: null, allowed: true });
  });

  it('rejects every other origin', () => {
    const decision = decideOrigin(options, 'https://evil.example');

    expect(decision.allowed).toBe(false);
    expect(decision.error?.message).toBe('CORS origin not allowed: https://evil.example');
  });

  it('rejects near misses of allowed origins', () => {
    expect(decideOrigin(options, 'http://localhost:9081').allowed).toBe(false);
    expect(decideOrigin(options, 'https://localhost:8081').allowed).toBe(false);
    expect(decideOrigin(options, 'https://admin.nearby.test.evil.example').allowed).toBe(false);
  });

  it('rejects everything but local origins when no allow list is configured', () => {
    const strict = corsOptionsFromConfig(new AppConfigService(validEnv()));

    expect(decideOrigin(strict, 'https://admin.nearby.test').allowed).toBe(false);
    expect(decideOrigin(strict, 'http://localhost:8081').allowed).toBe(true);
  });
});

describe('isOriginAllowed', () => {
  it('matches listed origins exactly', () => {
    expect(isOriginAllowed('https://a.example', ['https://a.example'])).toBe(true);
    expect(isOriginAllowed('https://a.example/', ['https://a.example'])).toBe(false);
    expect(isOriginAllowed('https://A.example', ['https://a.example'])).toBe(false);
  });
});
