import { describe, expect, it, vi } from 'vitest';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { PrismaUsersRepository } from './prisma-users.repository';

const storedUser = {
  id: '17b5a1ef-6ab4-47c7-8ed7-8f061eb54827',
  authProviderId: 'supabase-user-123',
  emailEncrypted: 'enc-email',
  emailHash: 'hash-email',
  phoneEncrypted: 'enc-phone',
  phoneHash: 'hash-phone',
  country: 'AE',
  preferredLanguage: 'en',
  timezone: 'Asia/Dubai',
};

function repositoryWith(upsert: ReturnType<typeof vi.fn>): PrismaUsersRepository {
  return new PrismaUsersRepository({ user: { upsert } } as unknown as PrismaService);
}

describe('PrismaUsersRepository', () => {
  it('returns the sender exactly as stored once the language column is varchar (CB-075)', async () => {
    const upsert = vi.fn().mockResolvedValue(storedUser);

    const sender = await repositoryWith(upsert).upsertSenderByAuthProviderId({
      authProviderId: 'supabase-user-123',
      emailEncrypted: 'enc-email',
      emailHash: 'hash-email',
      phoneEncrypted: 'enc-phone',
      phoneHash: 'hash-phone',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    });

    expect(sender.preferredLanguage).toBe('en');
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { authProviderId: 'supabase-user-123' },
        update: expect.objectContaining({ preferredLanguage: 'en' }),
      }),
    );
  });

  it('trims a padded language read from a database that still has the char(5) column', async () => {
    const upsert = vi.fn().mockResolvedValue({ ...storedUser, preferredLanguage: 'en   ' });

    const sender = await repositoryWith(upsert).upsertSenderByAuthProviderId({
      authProviderId: 'supabase-user-123',
      emailEncrypted: 'enc-email',
      emailHash: 'hash-email',
      phoneEncrypted: 'enc-phone',
      phoneHash: 'hash-phone',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    });

    expect(sender.preferredLanguage).toBe('en');
  });

  it('refuses to map a row without an auth provider id', async () => {
    const upsert = vi.fn().mockResolvedValue({ ...storedUser, authProviderId: null });

    await expect(
      repositoryWith(upsert).upsertSenderByAuthProviderId({
        authProviderId: 'supabase-user-123',
        emailEncrypted: 'enc-email',
        emailHash: 'hash-email',
        phoneEncrypted: 'enc-phone',
        phoneHash: 'hash-phone',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    ).rejects.toThrow('Sender record is missing auth provider id');
  });
});
