import { describe, expect, it } from 'vitest';
import { normalizePhone } from './phone-normalizer';

describe('normalizePhone', () => {
  it('normalizes valid phone numbers to E.164', () => {
    expect(normalizePhone('98765 43210', 'IN')).toBe('+919876543210');
  });

  it('rejects invalid phone numbers', () => {
    expect(() => normalizePhone('123', 'IN')).toThrow('Invalid phone number');
  });
});
