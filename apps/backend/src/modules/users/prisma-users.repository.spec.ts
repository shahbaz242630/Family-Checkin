import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaUsersRepository } from './prisma-users.repository';
import { SenderUniqueConflictError } from './users.repository';

const storedUser = {
  id: '17b5a1ef-6ab4-47c7-8ed7-8f061eb54827',
  authProviderId: 'supabase-user-123',
  emailEncrypted: 'enc-email',
  emailHash: 'hash-email',
  phoneEncrypted: 'enc-phone',
  phoneHash: 'hash-phone',
  displayNameEncrypted: null,
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

const identity = {
  authProviderId: 'supabase-user-123',
  emailEncrypted: 'enc-email',
  emailHash: 'hash-email',
  phoneEncrypted: 'enc-phone',
  phoneHash: 'hash-phone',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

function repositoryWith(user: Record<string, ReturnType<typeof vi.fn>>): PrismaUsersRepository {
  return new PrismaUsersRepository({ user } as unknown as PrismaService);
}

function uniqueViolation(): Error {
  return Object.assign(new Error('Unique constraint failed on the fields: (`phoneHash`)'), {
    code: 'P2002',
    clientVersion: 'test',
  });
}

describe('PrismaUsersRepository', () => {
  describe('read path for authenticated routes (CB-024)', () => {
    it('finds a sender by authProviderId with a single read and no write', async () => {
      const findUnique = vi.fn().mockResolvedValueOnce(storedUser).mockResolvedValueOnce(null);
      const create = vi.fn();
      const upsert = vi.fn();
      const repository = repositoryWith({ findUnique, create, upsert });

      await expect(repository.findSenderByAuthProviderId('supabase-user-123')).resolves.toMatchObject({
        id: storedUser.id,
        authProviderId: 'supabase-user-123',
        preferredLanguage: 'en',
      });
      await expect(repository.findSenderByAuthProviderId('supabase-user-unknown')).resolves.toBeNull();

      expect(findUnique).toHaveBeenCalledWith({ where: { authProviderId: 'supabase-user-123' } });
      expect(create).not.toHaveBeenCalled();
      expect(upsert).not.toHaveBeenCalled();
    });

    it('inserts a never-synced sender with the display name column explicit', async () => {
      const create = vi.fn().mockResolvedValue({ ...storedUser, displayNameEncrypted: 'enc-name' });

      const sender = await repositoryWith({ create }).createSender({ ...identity, displayNameEncrypted: 'enc-name' });

      expect(sender.displayNameEncrypted).toBe('enc-name');
      expect(create).toHaveBeenCalledWith({ data: { ...identity, displayNameEncrypted: 'enc-name' } });
    });

    it('reports a unique-index rejection of the insert as SenderUniqueConflictError and rethrows anything else', async () => {
      const create = vi
        .fn()
        .mockRejectedValueOnce(uniqueViolation())
        .mockRejectedValueOnce(new Error('connection reset'));
      const repository = repositoryWith({ create });

      await expect(repository.createSender(identity)).rejects.toBeInstanceOf(SenderUniqueConflictError);
      await expect(repository.createSender(identity)).rejects.toThrow('connection reset');
    });
  });

  it('returns the sender exactly as stored once the language column is varchar (CB-075)', async () => {
    const upsert = vi.fn().mockResolvedValue(storedUser);

    const sender = await repositoryWith({ upsert }).upsertSenderByAuthProviderId(identity);

    expect(sender.preferredLanguage).toBe('en');
    expect(sender.displayNameEncrypted).toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authProviderId: 'supabase-user-123' },
        update: expect.objectContaining({ preferredLanguage: 'en' }),
      }),
    );
  });

  it('trims a padded language read from a database that still has the char(5) column', async () => {
    const upsert = vi.fn().mockResolvedValue({ ...storedUser, preferredLanguage: 'en   ' });

    const sender = await repositoryWith({ upsert }).upsertSenderByAuthProviderId(identity);

    expect(sender.preferredLanguage).toBe('en');
  });

  it('refuses to map a row without an auth provider id', async () => {
    const upsert = vi.fn().mockResolvedValue({ ...storedUser, authProviderId: null });

    await expect(repositoryWith({ upsert }).upsertSenderByAuthProviderId(identity)).rejects.toThrow(
      'Sender record is missing auth provider id',
    );
  });

  it('reports a unique-index rejection of the upsert as SenderUniqueConflictError', async () => {
    const upsert = vi.fn().mockRejectedValue(uniqueViolation());

    await expect(repositoryWith({ upsert }).upsertSenderByAuthProviderId(identity)).rejects.toBeInstanceOf(
      SenderUniqueConflictError,
    );
  });

  describe('sender display name (CB-010)', () => {
    it('writes the encrypted display name on create and update when the identity carries one', async () => {
      const upsert = vi.fn().mockResolvedValue({ ...storedUser, displayNameEncrypted: 'enc-name' });

      const sender = await repositoryWith({ upsert }).upsertSenderByAuthProviderId({
        ...identity,
        displayNameEncrypted: 'enc-name',
      });

      expect(sender.displayNameEncrypted).toBe('enc-name');
      expect(upsert).toHaveBeenCalledWith({
        where: { authProviderId: 'supabase-user-123' },
        create: { ...identity, displayNameEncrypted: 'enc-name' },
        update: expect.objectContaining({ displayNameEncrypted: 'enc-name' }),
      });
    });

    it('leaves a stored display name alone when the identity carries none', async () => {
      const upsert = vi.fn().mockResolvedValue({ ...storedUser, displayNameEncrypted: 'enc-name-kept' });

      const sender = await repositoryWith({ upsert }).upsertSenderByAuthProviderId(identity);

      expect(sender.displayNameEncrypted).toBe('enc-name-kept');
      const args = upsert.mock.calls[0]?.[0] as { create: Record<string, unknown>; update: Record<string, unknown> };
      expect(args.create.displayNameEncrypted).toBeNull();
      expect(args.update).not.toHaveProperty('displayNameEncrypted');
    });

    it('reads the encrypted display name of a live sender only', async () => {
      const findFirst = vi.fn().mockResolvedValueOnce({ displayNameEncrypted: 'enc-name' }).mockResolvedValueOnce(null);
      const repository = repositoryWith({ findFirst });

      await expect(repository.findDisplayNameEncryptedById('user-1')).resolves.toBe('enc-name');
      await expect(repository.findDisplayNameEncryptedById('user-deleted')).resolves.toBeNull();
      expect(findFirst).toHaveBeenCalledWith({
        where: { id: 'user-1', deletedAt: null },
        select: { displayNameEncrypted: true },
      });
    });
  });
});
