import { describe, expect, it } from 'vitest';
import {
  BackendRequestError,
  isNotFoundError,
  isPaidAccessRequiredError,
  PAID_ACCESS_REQUIRED_MESSAGE,
} from './backendErrors';

describe('backend error helpers', () => {
  it('identifies paid-access backend failures by error code', () => {
    expect(isPaidAccessRequiredError(new BackendRequestError('Payment required', 403, 'PAID_ACCESS_REQUIRED'))).toBe(
      true,
    );
  });

  it('keeps identifying older paid-access backend failures by message', () => {
    expect(isPaidAccessRequiredError(new BackendRequestError(PAID_ACCESS_REQUIRED_MESSAGE, 403))).toBe(true);
  });

  it('does not treat unrelated backend errors as paid-access failures', () => {
    expect(isPaidAccessRequiredError(new BackendRequestError(PAID_ACCESS_REQUIRED_MESSAGE, 500))).toBe(false);
    expect(isPaidAccessRequiredError(new BackendRequestError('Receiver not found', 403))).toBe(false);
    expect(isPaidAccessRequiredError(new BackendRequestError('Payment required', 403, 'OTHER_ERROR'))).toBe(false);
    expect(isPaidAccessRequiredError(new Error(PAID_ACCESS_REQUIRED_MESSAGE))).toBe(false);
  });

  it('recognises a 404 from the backend as "not found" (removed receiver, superseded check-in)', () => {
    expect(isNotFoundError(new BackendRequestError('Receiver not found', 404))).toBe(true);
    expect(isNotFoundError(new BackendRequestError('Check-in not found', 404, 'NOT_FOUND'))).toBe(true);
  });

  it('does not treat other failures as "not found"', () => {
    expect(isNotFoundError(new BackendRequestError('Forbidden', 403))).toBe(false);
    expect(isNotFoundError(new BackendRequestError('Server error', 500))).toBe(false);
    expect(isNotFoundError(new Error('Receiver not found'))).toBe(false);
    expect(isNotFoundError(undefined)).toBe(false);
    expect(isNotFoundError({ status: 404 })).toBe(false);
  });
});
