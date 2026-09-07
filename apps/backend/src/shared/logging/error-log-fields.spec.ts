import { describe, expect, it } from 'vitest';
import { TwilioRequestError } from '../../modules/channels/twilio-request-error';
import { errorLogFields, providerErrorCodeOf } from './error-log-fields';

describe('errorLogFields', () => {
  it('carries the Twilio code of a provider rejection (CB-019, CB-047)', () => {
    const fields = errorLogFields(new TwilioRequestError(400, 21606, 'https://www.twilio.com/docs/errors/21606'));

    expect(fields).toEqual({
      error: 'Twilio request failed (HTTP 400, error code 21606, see https://www.twilio.com/docs/errors/21606)',
      errorName: 'TwilioRequestError',
      providerErrorCode: 21606,
    });
    // TwilioRequestError drops Twilio's own message, which quotes the rejected number.
    expect(JSON.stringify(fields)).not.toContain('+971');
  });

  it('falls back to the error name and message for anything else', () => {
    expect(errorLogFields(new TypeError('Cannot read properties of undefined'))).toEqual({
      error: 'Cannot read properties of undefined',
      errorName: 'TypeError',
    });
    expect(errorLogFields('boom')).toEqual({ error: 'unknown error', errorName: 'string' });
    expect(errorLogFields(undefined)).toEqual({ error: 'unknown error', errorName: 'undefined' });
  });

  it('bounds the message so one error cannot flood the log pipeline', () => {
    const fields = errorLogFields(new Error('x'.repeat(1000)));

    expect(fields.error).toHaveLength(301);
    expect(fields.error.endsWith('…')).toBe(true);
  });
});

describe('providerErrorCodeOf', () => {
  it('reads an integer code and ignores anything else', () => {
    expect(providerErrorCodeOf(new TwilioRequestError(400, 21211))).toBe(21211);
    expect(providerErrorCodeOf(new TwilioRequestError(502, undefined))).toBeUndefined();
    expect(providerErrorCodeOf({ code: 'ECONNRESET' })).toBeUndefined();
    expect(providerErrorCodeOf({ code: 1.5 })).toBeUndefined();
    expect(providerErrorCodeOf(null)).toBeUndefined();
  });
});
