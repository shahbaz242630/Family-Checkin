import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { UsersService } from './users.service';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryUsersRepository implements UsersRepository {
  public lastInput: UpsertSenderRecordInput | null = null;

  async upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    this.lastInput = input;
    return {
      id: '17b5a1ef-6ab4-47c7-8ed7-8f061eb54827',
      ...input,
    };
  }
}

describe('UsersService', () => {
  it('normalizes, hashes, encrypts, and upserts a Supabase sender identity', async () => {
    const repository = new InMemoryUsersRepository();
    const crypto = new CryptoService(masterKey);
    const service = new UsersService(repository, crypto);

    const sender = await service.upsertFromSupabaseIdentity({
      authProviderId: 'supabase-user-123',
      email: ' Ahmed.Example@Email.COM ',
      phone: '98765 43210',
      phoneCountry: 'IN',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    });

    expect(sender.id).toBe('17b5a1ef-6ab4-47c7-8ed7-8f061eb54827');
    expect(repository.lastInput).toMatchObject({
      authProviderId: 'supabase-user-123',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
      emailHash: crypto.hashForLookup('ahmed.example@email.com'),
      phoneHash: crypto.hashForLookup('+919876543210'),
    });
    expect(crypto.decrypt(repository.lastInput?.emailEncrypted ?? '')).toBe('ahmed.example@email.com');
    expect(crypto.decrypt(repository.lastInput?.phoneEncrypted ?? '')).toBe('+919876543210');
  });

  it('stores the preferred language trimmed so a padded char(5) value can never round-trip (CB-075)', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    const sender = await service.upsertFromSupabaseIdentity({
      authProviderId: 'supabase-user-123',
      email: 'sender@example.com',
      phone: '+971501234567',
      country: 'AE',
      preferredLanguage: ' en   ',
      timezone: 'Asia/Dubai',
    });

    expect(repository.lastInput?.preferredLanguage).toBe('en');
    expect(sender.preferredLanguage).toBe('en');
  });

  it('defaults a blank preferred language to English instead of writing an empty string', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    await service.upsertFromSupabaseIdentity({
      authProviderId: 'supabase-user-123',
      email: 'sender@example.com',
      phone: '+971501234567',
      country: 'AE',
      preferredLanguage: '   ',
      timezone: 'Asia/Dubai',
    });

    expect(repository.lastInput?.preferredLanguage).toBe('en');
  });

  it('requires a verified email and phone to create an app user', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    await expect(
      service.upsertFromSupabaseIdentity({
        authProviderId: 'supabase-user-123',
        email: '',
        phone: '98765 43210',
        phoneCountry: 'IN',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    ).rejects.toThrow('Sender email is required');

    await expect(
      service.upsertFromSupabaseIdentity({
        authProviderId: 'supabase-user-123',
        email: 'sender@example.com',
        phone: '',
        phoneCountry: 'IN',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    ).rejects.toThrow('Sender phone is required');
  });
});
