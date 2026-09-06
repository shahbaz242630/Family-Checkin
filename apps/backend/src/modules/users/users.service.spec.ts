import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { CryptoService } from '../../shared/crypto/crypto.service';
import { UsersService } from './users.service';
import { SenderUniqueConflictError } from './users.repository';
import type { SenderRecord, UpsertSenderRecordInput, UsersRepository } from './users.repository';

const masterKey = Buffer.from('0123456789abcdef0123456789abcdef', 'utf8');

class InMemoryUsersRepository implements UsersRepository {
  /** Rows by `authProviderId`, as the database would hold them. */
  public rows = new Map<string, SenderRecord>();
  public lookups: string[] = [];
  public creates: UpsertSenderRecordInput[] = [];
  public upserts: UpsertSenderRecordInput[] = [];
  /** Thrown by the next `createSender`, to play the losing side of a first-request race. */
  public nextCreateError: Error | null = null;
  public nextUpsertError: Error | null = null;
  /** `displayNameEncrypted` per user id, as `findDisplayNameEncryptedById` would read it. */
  public displayNamesEncrypted = new Map<string, string | null>();
  public lookedUp: string[] = [];

  /** Convenience for the "already synced" cases. */
  get lastInput(): UpsertSenderRecordInput | null {
    return this.upserts.at(-1) ?? this.creates.at(-1) ?? null;
  }

  async findSenderByAuthProviderId(authProviderId: string): Promise<SenderRecord | null> {
    this.lookups.push(authProviderId);
    return this.rows.get(authProviderId) ?? null;
  }

  async createSender(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    if (this.nextCreateError) {
      const error = this.nextCreateError;
      this.nextCreateError = null;
      throw error;
    }
    this.creates.push(input);
    const row = { id: `user-${this.rows.size + 1}`, ...input };
    this.rows.set(input.authProviderId, row);
    return row;
  }

  async upsertSenderByAuthProviderId(input: UpsertSenderRecordInput): Promise<SenderRecord> {
    if (this.nextUpsertError) {
      const error = this.nextUpsertError;
      this.nextUpsertError = null;
      throw error;
    }
    this.upserts.push(input);
    const row = { id: this.rows.get(input.authProviderId)?.id ?? '17b5a1ef-6ab4-47c7-8ed7-8f061eb54827', ...input };
    this.rows.set(input.authProviderId, row);
    return row;
  }

  async findDisplayNameEncryptedById(userId: string): Promise<string | null> {
    this.lookedUp.push(userId);
    return this.displayNamesEncrypted.get(userId) ?? null;
  }
}

const identity = {
  authProviderId: 'supabase-user-123',
  email: 'sender@example.com',
  phone: '+971501234567',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

function existingRow(overrides: Partial<SenderRecord> = {}): SenderRecord {
  return {
    id: 'user-existing',
    authProviderId: 'supabase-user-123',
    emailEncrypted: 'enc-email',
    emailHash: 'hash-email',
    phoneEncrypted: 'enc-phone',
    phoneHash: 'hash-phone',
    country: 'AE',
    preferredLanguage: 'en',
    timezone: 'Asia/Dubai',
    ...overrides,
  };
}

describe('UsersService resolves the sender for authenticated routes (CB-024)', () => {
  it('reads an existing sender by authProviderId and writes nothing, whatever the token metadata says now', async () => {
    const repository = new InMemoryUsersRepository();
    repository.rows.set('supabase-user-123', existingRow());
    const service = new UsersService(repository, new CryptoService(masterKey));

    const sender = await service.findOrCreateFromSupabaseIdentity({
      ...identity,
      phone: 'garbage that must not matter',
      country: 'GB',
      preferredLanguage: 'ar',
      timezone: 'Europe/London',
      displayName: 'New Name',
    });

    expect(sender).toEqual(existingRow());
    expect(repository.lookups).toEqual(['supabase-user-123']);
    expect(repository.creates).toEqual([]);
    expect(repository.upserts).toEqual([]);
  });

  it('accepts an existing sender whose token carries no phone at all', async () => {
    const repository = new InMemoryUsersRepository();
    repository.rows.set('supabase-user-123', existingRow());
    const service = new UsersService(repository, new CryptoService(masterKey));

    const { phone: _phone, ...withoutPhone } = identity;
    await expect(service.findOrCreateFromSupabaseIdentity(withoutPhone)).resolves.toEqual(existingRow());
    expect(repository.creates).toEqual([]);
  });

  it('inserts a sender the app never synced exactly once and reads it on the next request', async () => {
    const repository = new InMemoryUsersRepository();
    const crypto = new CryptoService(masterKey);
    const service = new UsersService(repository, crypto);

    const first = await service.findOrCreateFromSupabaseIdentity({
      ...identity,
      email: ' Ahmed.Example@Email.COM ',
      phone: '98765 43210',
      phoneCountry: 'IN',
      displayName: ' Ahmed ',
    });
    const second = await service.findOrCreateFromSupabaseIdentity({ ...identity, displayName: 'Changed' });

    expect(second).toEqual(first);
    expect(repository.creates).toHaveLength(1);
    expect(repository.upserts).toEqual([]);
    expect(repository.creates[0]).toMatchObject({
      authProviderId: 'supabase-user-123',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
      emailHash: crypto.hashForLookup('ahmed.example@email.com'),
      phoneHash: crypto.hashForLookup('+919876543210'),
    });
    expect(crypto.decrypt(repository.creates[0]?.emailEncrypted ?? '')).toBe('ahmed.example@email.com');
    expect(crypto.decrypt(repository.creates[0]?.phoneEncrypted ?? '')).toBe('+919876543210');
    expect(crypto.decrypt(repository.creates[0]?.displayNameEncrypted ?? '')).toBe('Ahmed');
  });

  it('parses a national-format phone with the identity country when no phone country is given', async () => {
    const repository = new InMemoryUsersRepository();
    const crypto = new CryptoService(masterKey);
    const service = new UsersService(repository, crypto);

    await service.findOrCreateFromSupabaseIdentity({ ...identity, phone: '050 123 4567' });

    expect(repository.creates[0]?.phoneHash).toBe(crypto.hashForLookup('+971501234567'));
  });

  it('reads the row the other first request inserted when the insert loses the race', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));
    repository.nextCreateError = new SenderUniqueConflictError('supabase-user-123');
    const raced = existingRow({ id: 'user-from-other-request' });
    repository.findSenderByAuthProviderId = async (authProviderId) => {
      repository.lookups.push(authProviderId);
      return repository.lookups.length > 1 ? raced : null;
    };

    await expect(service.findOrCreateFromSupabaseIdentity(identity)).resolves.toEqual(raced);
    expect(repository.lookups).toEqual(['supabase-user-123', 'supabase-user-123']);
  });

  it('answers 409 when the phone or email already belongs to a different account', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));
    repository.nextCreateError = new SenderUniqueConflictError('supabase-user-123');

    await expect(service.findOrCreateFromSupabaseIdentity(identity)).rejects.toBeInstanceOf(ConflictException);
  });

  it('refuses to insert a sender without a usable phone with 401, never 500', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    const { phone: _phone, ...withoutPhone } = identity;
    await expect(service.findOrCreateFromSupabaseIdentity(withoutPhone)).rejects.toThrow(
      new UnauthorizedException('Supabase user is missing a phone number'),
    );
    await expect(service.findOrCreateFromSupabaseIdentity({ ...identity, phone: '   ' })).rejects.toThrow(
      new UnauthorizedException('Supabase user is missing a phone number'),
    );
    await expect(service.findOrCreateFromSupabaseIdentity({ ...identity, phone: 'call me maybe' })).rejects.toThrow(
      new UnauthorizedException('Supabase user phone number is invalid'),
    );
    await expect(service.findOrCreateFromSupabaseIdentity({ ...identity, email: '  ' })).rejects.toThrow(
      new UnauthorizedException('Supabase user is missing an email'),
    );
    expect(repository.creates).toEqual([]);
  });

  it('keeps upsertFromSupabaseIdentity as the read-or-insert path for controllers not yet renamed', async () => {
    const repository = new InMemoryUsersRepository();
    repository.rows.set('supabase-user-123', existingRow());
    const service = new UsersService(repository, new CryptoService(masterKey));

    await expect(service.upsertFromSupabaseIdentity({ ...identity, country: 'GB' })).resolves.toEqual(existingRow());
    expect(repository.upserts).toEqual([]);
    expect(repository.creates).toEqual([]);
  });
});

describe('UsersService syncs the profile from POST /auth/sync-user', () => {
  it('normalizes, hashes, encrypts, and upserts a Supabase sender identity', async () => {
    const repository = new InMemoryUsersRepository();
    const crypto = new CryptoService(masterKey);
    const service = new UsersService(repository, crypto);

    const sender = await service.syncProfileFromSupabaseIdentity({
      authProviderId: 'supabase-user-123',
      email: ' Ahmed.Example@Email.COM ',
      phone: '98765 43210',
      phoneCountry: 'IN',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    });

    expect(sender.id).toBe('17b5a1ef-6ab4-47c7-8ed7-8f061eb54827');
    expect(repository.upserts).toHaveLength(1);
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
    // No name in the identity: nothing is written, so a stored name survives a metadata-less sync.
    expect(repository.lastInput).not.toHaveProperty('displayNameEncrypted');
  });

  it('overwrites the profile columns of an existing sender, which the read path never does', async () => {
    const repository = new InMemoryUsersRepository();
    repository.rows.set('supabase-user-123', existingRow());
    const service = new UsersService(repository, new CryptoService(masterKey));

    const sender = await service.syncProfileFromSupabaseIdentity({
      ...identity,
      country: 'GB',
      timezone: 'Europe/London',
    });

    expect(sender).toMatchObject({ id: 'user-existing', country: 'GB', timezone: 'Europe/London' });
    expect(repository.upserts).toHaveLength(1);
  });

  it('stores the preferred language trimmed so a padded char(5) value can never round-trip (CB-075)', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    const sender = await service.syncProfileFromSupabaseIdentity({ ...identity, preferredLanguage: ' en   ' });

    expect(repository.lastInput?.preferredLanguage).toBe('en');
    expect(sender.preferredLanguage).toBe('en');
  });

  it('defaults a blank preferred language to English instead of writing an empty string', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    await service.syncProfileFromSupabaseIdentity({ ...identity, preferredLanguage: '   ' });

    expect(repository.lastInput?.preferredLanguage).toBe('en');
  });

  it('requires an email and a phone to sync a profile, answering 401 as the route always has', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));

    await expect(service.syncProfileFromSupabaseIdentity({ ...identity, email: '' })).rejects.toThrow(
      new UnauthorizedException('Supabase user is missing an email'),
    );
    await expect(service.syncProfileFromSupabaseIdentity({ ...identity, phone: '' })).rejects.toThrow(
      new UnauthorizedException('Supabase user is missing a phone number'),
    );
    await expect(service.syncProfileFromSupabaseIdentity({ ...identity, phone: '12' })).rejects.toThrow(
      new UnauthorizedException('Supabase user phone number is invalid'),
    );
    expect(repository.upserts).toEqual([]);
  });

  it('answers 409 when the synced phone or email already belongs to another account', async () => {
    const repository = new InMemoryUsersRepository();
    const service = new UsersService(repository, new CryptoService(masterKey));
    repository.nextUpsertError = new SenderUniqueConflictError('supabase-user-123');

    await expect(service.syncProfileFromSupabaseIdentity(identity)).rejects.toBeInstanceOf(ConflictException);
  });

  describe('sender display name (CB-010)', () => {
    it('stores the display name encrypted, trimmed and with inner whitespace collapsed', async () => {
      const repository = new InMemoryUsersRepository();
      const crypto = new CryptoService(masterKey);
      const service = new UsersService(repository, crypto);

      await service.syncProfileFromSupabaseIdentity({ ...identity, displayName: '  Sam \n  Malik ' });

      expect(repository.lastInput?.displayNameEncrypted).toBeDefined();
      expect(repository.lastInput?.displayNameEncrypted).not.toContain('Sam');
      expect(crypto.decrypt(repository.lastInput?.displayNameEncrypted ?? '')).toBe('Sam Malik');
    });

    it('caps the stored name at 80 characters and treats a blank name as absent', async () => {
      const repository = new InMemoryUsersRepository();
      const crypto = new CryptoService(masterKey);
      const service = new UsersService(repository, crypto);

      await service.syncProfileFromSupabaseIdentity({
        ...identity,
        displayName: `${'A'.repeat(79)} ${'B'.repeat(20)}`,
      });
      expect(crypto.decrypt(repository.lastInput?.displayNameEncrypted ?? '')).toBe('A'.repeat(79));

      await service.syncProfileFromSupabaseIdentity({ ...identity, displayName: '   ' });
      expect(repository.lastInput).not.toHaveProperty('displayNameEncrypted');
    });

    it('returns the decrypted name for receiver-facing copy and the neutral wording when none is stored', async () => {
      const repository = new InMemoryUsersRepository();
      const crypto = new CryptoService(masterKey);
      const service = new UsersService(repository, crypto);
      repository.displayNamesEncrypted.set('sender-named', crypto.encrypt('Sam'));
      repository.displayNamesEncrypted.set('sender-blank', crypto.encrypt('   '));

      await expect(service.senderDisplayNameFor('sender-named')).resolves.toBe('Sam');
      await expect(service.senderDisplayNameFor('sender-unknown')).resolves.toBe('your family member');
      await expect(service.senderDisplayNameFor('sender-blank')).resolves.toBe('your family member');
      await expect(service.senderDisplayNameFor('sender-unknown', 'their family member')).resolves.toBe(
        'their family member',
      );
      expect(repository.lookedUp).toEqual(['sender-named', 'sender-unknown', 'sender-blank', 'sender-unknown']);
    });
  });
});
