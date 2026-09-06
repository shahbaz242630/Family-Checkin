import { describe, expect, it } from 'vitest';
import {
  backendErrorCode,
  BackendRequestError,
  describeBackendError,
  formatBackendDate,
  isBackendErrorCode,
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

  it('exposes the backend code only for typed backend failures', () => {
    expect(backendErrorCode(new BackendRequestError('Conflict', 409, 'CHECK_IN_IN_PROGRESS'))).toBe(
      'CHECK_IN_IN_PROGRESS',
    );
    expect(backendErrorCode(new BackendRequestError('Conflict', 409))).toBeUndefined();
    expect(backendErrorCode(new Error('CHECK_IN_IN_PROGRESS'))).toBeUndefined();
    expect(
      isBackendErrorCode(new BackendRequestError('Conflict', 409, 'CONSENT_NOT_PENDING'), 'CONSENT_NOT_PENDING'),
    ).toBe(true);
    expect(
      isBackendErrorCode(new BackendRequestError('Conflict', 409, 'CONSENT_NOT_PENDING'), 'OPT_OUT_COOLDOWN'),
    ).toBe(false);
  });

  it('defaults details to an empty object', () => {
    expect(new BackendRequestError('Conflict', 409, 'RECEIVER_ALREADY_MONITORED').details).toEqual({});
  });
});

describe('describeBackendError', () => {
  const formatDate = (isoDate: string) => `<${isoDate}>`;

  it('explains the opt-out cooldown with the date the phone can be invited again (CB-009)', () => {
    const error = new BackendRequestError(
      'This person opted out of Nearby check-ins recently',
      409,
      'OPT_OUT_COOLDOWN',
      {
        cooldownUntil: '2026-09-13T10:00:00.000Z',
      },
    );

    expect(describeBackendError(error, 'Please try again.', { formatDate })).toBe(
      'This person opted out recently; you can invite them again after <2026-09-13T10:00:00.000Z>.',
    );
  });

  it('still explains the cooldown when the body carries no date', () => {
    const error = new BackendRequestError('Opted out', 409, 'OPT_OUT_COOLDOWN');

    expect(describeBackendError(error, 'Please try again.', { formatDate })).toBe(
      'This person opted out recently; you can invite them again once their opt-out cooldown ends.',
    );
  });

  it('explains a phone another account already monitors (CB-014)', () => {
    const error = new BackendRequestError('Already receiving check-ins', 409, 'RECEIVER_ALREADY_MONITORED');

    expect(describeBackendError(error, 'Please try again.')).toBe(
      'This phone number already receives Nearby check-ins from another account.',
    );
  });

  it('explains a check-in still in progress (CB-017)', () => {
    const error = new BackendRequestError('The current check-in is still in progress', 409, 'CHECK_IN_IN_PROGRESS');

    expect(describeBackendError(error, 'Unable to alert backup contacts')).toBe(
      'A check-in is still in progress for this receiver. Wait for it to finish before trying again.',
    );
  });

  it('explains that an answered invitation cannot be resent', () => {
    const error = new BackendRequestError(
      'Consent can only be re-requested while pending',
      409,
      'CONSENT_NOT_PENDING',
      {
        consentStatus: 'GRANTED',
      },
    );

    expect(describeBackendError(error, 'Unable to resend')).toBe(
      'This receiver has already answered the invitation, so it cannot be resent.',
    );
  });

  it('tells the sender when the next invitation may go out (CB-009)', () => {
    const error = new BackendRequestError(
      'A consent request was sent in the last 7 days',
      429,
      'CONSENT_RESEND_LIMIT',
      {
        nextAllowedAt: '2026-09-13T09:00:00.000Z',
      },
    );

    expect(describeBackendError(error, 'Unable to resend', { formatDate })).toBe(
      'You can resend on <2026-09-13T09:00:00.000Z>.',
    );
    expect(
      describeBackendError(new BackendRequestError('Limit', 429, 'CONSENT_RESEND_LIMIT'), 'Unable to resend'),
    ).toBe('You can resend once 7 days have passed since the last invitation.');
  });

  it('falls back to the backend message for other codes, then to the caller fallback', () => {
    expect(describeBackendError(new BackendRequestError('Receiver not found', 404), 'Unable to load')).toBe(
      'Receiver not found',
    );
    expect(describeBackendError(new BackendRequestError('Nope', 500, 'SOMETHING_ELSE'), 'Unable to load')).toBe('Nope');
    expect(describeBackendError(new Error('Network request failed'), 'Unable to load')).toBe('Network request failed');
    expect(describeBackendError(new Error(''), 'Unable to load')).toBe('Unable to load');
    expect(describeBackendError('string failure', 'Unable to load')).toBe('Unable to load');
    expect(describeBackendError(undefined, 'Unable to load')).toBe('Unable to load');
  });

  it('ignores a date detail that is not a string', () => {
    const error = new BackendRequestError('Limit', 429, 'CONSENT_RESEND_LIMIT', { nextAllowedAt: 12345 });

    expect(describeBackendError(error, 'Unable to resend', { formatDate })).toBe(
      'You can resend once 7 days have passed since the last invitation.',
    );
  });

  it('formats dates with the default formatter and leaves unparseable values alone', () => {
    expect(formatBackendDate('not-a-date')).toBe('not-a-date');
    const formatted = formatBackendDate('2026-09-13T09:00:00.000Z');
    expect(formatted).not.toBe('2026-09-13T09:00:00.000Z');
    expect(formatted).toMatch(/2026/);
    expect(
      describeBackendError(
        new BackendRequestError('Limit', 429, 'CONSENT_RESEND_LIMIT', { nextAllowedAt: '2026-09-13T09:00:00.000Z' }),
        'Unable to resend',
      ),
    ).toBe(`You can resend on ${formatted}.`);
  });
});
