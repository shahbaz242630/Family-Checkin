import { AdminRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { PrismaAdminUsersRepository } from './prisma-admin-users.repository';

describe('PrismaAdminUsersRepository', () => {
  it('finds an admin by auth provider id without selecting encrypted or hash fields', async () => {
    const calls: unknown[] = [];
    const prisma = {
      adminUser: {
        findFirst: async (args: unknown) => {
          calls.push(args);
          return {
            id: 'admin-id',
            authProviderId: 'supabase-admin-123',
            role: AdminRole.SUPER_ADMIN,
            active: true,
          };
        },
      },
    };
    const repository = new PrismaAdminUsersRepository(prisma);

    const admin = await repository.findByAuthProviderId('supabase-admin-123');

    expect(calls).toEqual([
      {
        where: { authProviderId: 'supabase-admin-123' },
        select: {
          id: true,
          authProviderId: true,
          role: true,
          active: true,
        },
      },
    ]);
    expect(JSON.stringify(calls)).not.toContain('emailEncrypted');
    expect(JSON.stringify(calls)).not.toContain('emailHash');
    expect(admin).toEqual({
      id: 'admin-id',
      authProviderId: 'supabase-admin-123',
      role: AdminRole.SUPER_ADMIN,
      active: true,
    });
  });

  it('returns null when no admin row exists', async () => {
    const repository = new PrismaAdminUsersRepository({
      adminUser: {
        findFirst: async () => null,
      },
    });

    await expect(repository.findByAuthProviderId('missing-admin')).resolves.toBeNull();
  });
});
