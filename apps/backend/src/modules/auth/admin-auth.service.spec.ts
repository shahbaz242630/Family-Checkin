import { AdminRole } from '@prisma/client';
import { ForbiddenException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { SupabaseAuthService } from './supabase-auth.service';
import type { AdminUsersRepository } from './admin-users.repository';
import { AdminAuthService } from './admin-auth.service';

class FakeSupabaseAuthService {
  async verifyAccessToken() {
    return {
      authProviderId: 'supabase-admin-123',
      email: 'admin@example.com',
      phone: '+971501234567',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    };
  }
}

class FakeAdminUsersRepository implements AdminUsersRepository {
  constructor(private readonly admin: Awaited<ReturnType<AdminUsersRepository['findByAuthProviderId']>>) {}

  public requestedAuthProviderId?: string;

  async findByAuthProviderId(authProviderId: string) {
    this.requestedAuthProviderId = authProviderId;
    return this.admin;
  }
}

describe('AdminAuthService', () => {
  it('returns an active allowlisted admin for an allowed role', async () => {
    const repository = new FakeAdminUsersRepository({
      id: 'admin-id',
      authProviderId: 'supabase-admin-123',
      role: AdminRole.OPERATOR,
      active: true,
    });
    const service = new AdminAuthService(new FakeSupabaseAuthService() as unknown as SupabaseAuthService, repository);

    const admin = await service.verifyAdminAccessToken('access-token', [AdminRole.OPERATOR]);

    expect(repository.requestedAuthProviderId).toBe('supabase-admin-123');
    expect(admin).toEqual({
      id: 'admin-id',
      authProviderId: 'supabase-admin-123',
      role: AdminRole.OPERATOR,
      active: true,
    });
  });

  it('rejects missing, inactive, and disallowed-role admins', async () => {
    const supabaseAuth = new FakeSupabaseAuthService() as unknown as SupabaseAuthService;

    await expect(new AdminAuthService(supabaseAuth, new FakeAdminUsersRepository(null)).verifyAdminAccessToken('token')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    await expect(
      new AdminAuthService(
        supabaseAuth,
        new FakeAdminUsersRepository({
          id: 'admin-id',
          authProviderId: 'supabase-admin-123',
          role: AdminRole.OPERATOR,
          active: false,
        }),
      ).verifyAdminAccessToken('token'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      new AdminAuthService(
        supabaseAuth,
        new FakeAdminUsersRepository({
          id: 'admin-id',
          authProviderId: 'supabase-admin-123',
          role: AdminRole.SUPPORT_READONLY,
          active: true,
        }),
      ).verifyAdminAccessToken('token', [AdminRole.OPERATOR]),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
