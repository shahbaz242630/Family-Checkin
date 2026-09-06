import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { assertBearerSecret, isMatchingSecret } from './bearer-secret';

describe('isMatchingSecret', () => {
  it('matches only the identical secret', () => {
    expect(isMatchingSecret('operations-cron-secret', 'operations-cron-secret')).toBe(true);
    expect(isMatchingSecret('operations-cron-secreT', 'operations-cron-secret')).toBe(false);
  });

  it('treats a length mismatch as a mismatch instead of throwing', () => {
    expect(isMatchingSecret('short', 'operations-cron-secret')).toBe(false);
    expect(isMatchingSecret('', 'operations-cron-secret')).toBe(false);
  });
});

describe('assertBearerSecret', () => {
  it('accepts exactly `Bearer <secret>`', () => {
    expect(() => assertBearerSecret('Bearer operations-cron-secret', 'operations-cron-secret', 'nope')).not.toThrow();
  });

  it('rejects a missing header, another scheme, an empty token and a wrong secret with 401', () => {
    for (const authorization of [undefined, '', 'Bearer', 'Bearer ', 'Basic operations-cron-secret', 'Bearer wrong']) {
      expect(() => assertBearerSecret(authorization, 'operations-cron-secret', 'Bearer token is required')).toThrow(
        UnauthorizedException,
      );
    }
    expect(() => assertBearerSecret(undefined, 'operations-cron-secret', 'Bearer token is required')).toThrow(
      'Bearer token is required',
    );
  });
});
