import { describe, expect, it } from 'vitest';
import { CryptoService } from './crypto.service';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

describe('CryptoService', () => {
  it('decrypts values encrypted with the same master key', () => {
    const crypto = new CryptoService(masterKey);

    const ciphertext = crypto.encrypt('salma@example.com');

    expect(crypto.decrypt(ciphertext)).toBe('salma@example.com');
  });

  it('uses a fresh IV so repeated encryption produces different ciphertext', () => {
    const crypto = new CryptoService(masterKey);

    const first = crypto.encrypt('+919876543210');
    const second = crypto.encrypt('+919876543210');

    expect(first).not.toBe(second);
    expect(crypto.decrypt(first)).toBe('+919876543210');
    expect(crypto.decrypt(second)).toBe('+919876543210');
  });

  it('creates deterministic hashes for lookup values', () => {
    const crypto = new CryptoService(masterKey);

    const first = crypto.hashForLookup('+919876543210');
    const second = crypto.hashForLookup('+919876543210');

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects invalid master key lengths', () => {
    expect(() => new CryptoService(Buffer.from('short', 'utf8'))).toThrow(
      'CryptoService requires a 32-byte master key',
    );
  });
});
