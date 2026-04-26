import { UnauthorizedException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import type { UsersService } from '../users/users.service';
import { AuthController } from './auth.controller';
import type { SupabaseAuthService } from './supabase-auth.service';

describe('AuthController', () => {
  it('syncs the authenticated Supabase user into the encrypted sender profile', async () => {
    const supabaseAuth = {
      verifyAccessToken: async () => ({
        authProviderId: 'supabase-user-123',
        email: 'sender@example.com',
        phone: '+971501234567',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      }),
    } satisfies Pick<SupabaseAuthService, 'verifyAccessToken'>;
    const users = {
      upsertFromSupabaseIdentity: async (input) => ({
        id: 'sender-id',
        authProviderId: input.authProviderId,
        emailEncrypted: 'encrypted-email',
        emailHash: 'email-hash',
        phoneEncrypted: 'encrypted-phone',
        phoneHash: 'phone-hash',
        country: input.country,
        preferredLanguage: input.preferredLanguage,
        timezone: input.timezone,
      }),
    } satisfies Pick<UsersService, 'upsertFromSupabaseIdentity'>;
    const controller = new AuthController(supabaseAuth as unknown as SupabaseAuthService, users as UsersService);

    await expect(controller.syncUser('Bearer access-token')).resolves.toEqual({
      user: {
        id: 'sender-id',
        country: 'AE',
        preferredLanguage: 'en',
        timezone: 'Asia/Dubai',
      },
    });
  });

  it('requires a bearer token', async () => {
    const controller = new AuthController({} as SupabaseAuthService, {} as UsersService);

    await expect(controller.syncUser(undefined)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.syncUser('Basic bad-token')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
