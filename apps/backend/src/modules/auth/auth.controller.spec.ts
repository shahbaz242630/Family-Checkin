import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { UsersService } from '../users/users.service';
import type { AdminAuthService } from './admin-auth.service';
import { AuthController } from './auth.controller';
import type { SupabaseAuthService } from './supabase-auth.service';

class FakeAdminAuthService {
  async verifyAdminAccessToken() {
    return {
      id: 'admin-id',
      authProviderId: 'supabase-admin-123',
      role: 'OPERATOR',
      active: true,
    };
  }
}

describe('AuthController', () => {
  it('syncs the authenticated Supabase user into the encrypted sender profile through the one upserting path (CB-024)', async () => {
    const tokens: string[] = [];
    const supabaseAuth = {
      verifyAccessToken: async (token: string) => {
        tokens.push(token);
        return {
          authProviderId: 'supabase-user-123',
          email: 'sender@example.com',
          phone: '+971501234567',
          displayName: 'Sam Malik',
          country: 'AE',
          preferredLanguage: 'en',
          timezone: 'Asia/Dubai',
        };
      },
    } satisfies Pick<SupabaseAuthService, 'verifyAccessToken'>;
    const synced: unknown[] = [];
    const users = {
      syncProfileFromSupabaseIdentity: async (input) => {
        synced.push(input);
        return {
          id: 'sender-id',
          authProviderId: input.authProviderId,
          emailEncrypted: 'encrypted-email',
          emailHash: 'email-hash',
          phoneEncrypted: 'encrypted-phone',
          phoneHash: 'phone-hash',
          country: input.country,
          preferredLanguage: input.preferredLanguage,
          timezone: input.timezone,
        };
      },
    } satisfies Pick<UsersService, 'syncProfileFromSupabaseIdentity'>;
    const controller = new AuthController(
      supabaseAuth,
      users as UsersService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.syncUser('Bearer access-token')).resolves.toEqual({
      user: {
        id: 'sender-id',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      },
    });
    expect(tokens).toEqual(['access-token']);
    expect(synced).toEqual([
      expect.objectContaining({ authProviderId: 'supabase-user-123', displayName: 'Sam Malik' }),
    ]);
  });

  it('requires a bearer token', async () => {
    const controller = new AuthController(
      {} as SupabaseAuthService,
      {} as UsersService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.syncUser(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.syncUser('Basic bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('returns the authenticated active admin identity', async () => {
    const controller = new AuthController(
      {} as SupabaseAuthService,
      {} as UsersService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.adminMe('Bearer admin-token')).resolves.toEqual({
      admin: {
        id: 'admin-id',
        role: 'OPERATOR',
      },
    });
  });

  it('requires a bearer token for admin identity', async () => {
    const controller = new AuthController(
      {} as SupabaseAuthService,
      {} as UsersService,
      new FakeAdminAuthService() as unknown as AdminAuthService,
    );

    await expect(controller.adminMe(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.adminMe('Basic admin-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
