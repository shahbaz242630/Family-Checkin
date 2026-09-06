import { timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

/**
 * Constant-time comparison of a presented secret against the expected one. A length mismatch is reported as
 * a plain `false` (never thrown) so callers get one code path for every wrong secret.
 */
export function isMatchingSecret(provided: string, expected: string): boolean {
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

/**
 * Throws 401 unless `authorization` is exactly `Bearer <expected>`. Shared by the machine-called routes that
 * authenticate with the operations cron secret (the scheduler's check-in run and the fake-mode reply route).
 */
export function assertBearerSecret(authorization: string | undefined, expected: string, message: string): void {
  const [scheme, token] = authorization?.split(' ') ?? [];

  if (scheme !== 'Bearer' || !token || !isMatchingSecret(token, expected)) {
    throw new UnauthorizedException(message);
  }
}
