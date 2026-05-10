import { describe, expect, it } from 'vitest';
import { BackendRequestError, isPaidAccessRequiredError, PAID_ACCESS_REQUIRED_MESSAGE } from './backendErrors';

describe('backend error helpers', () => {
  it('identifies paid-access backend failures by error code', () => {
    expect(isPaidAccessRequiredError(new BackendRequestError('Payment required', 403, 'PAID_ACCESS_REQUIRED'))).toBe(true);
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
});
