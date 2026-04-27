import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../shared/config/app-config.service';
import { SupabaseAuthService } from './supabase-auth.service';

describe('SupabaseAuthService', () => {
  const config = new AppConfigService({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
    KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    SUPABASE_URL: 'https://nrohtflgytywovwabvdo.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
  });

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('verifies a Supabase access token through the Auth user endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'supabase-user-123',
        email: 'sender@example.com',
        phone: '+971501234567',
        user_metadata: {
          country: 'AE',
          preferred_language: 'en',
          timezone: 'Asia/Dubai',
        },
      }),
    });
    const service = new SupabaseAuthService(config, fetchMock);

    const identity = await service.verifyAccessToken('access-token');

    expect(fetchMock).toHaveBeenCalledWith('https://nrohtflgytywovwabvdo.supabase.co/auth/v1/user', {
      headers: {
        apikey: 'anon-key',
        Authorization: 'Bearer access-token',
      },
    });
    expect(identity).toEqual({
      authProviderId: 'supabase-user-123',
      email: 'sender@example.com',
      phone: '+971501234567',
      country: 'AE',
      preferredLanguage: 'en',
      timezone: 'Asia/Dubai',
    });
  });

  it('rejects invalid Supabase access tokens', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ message: 'invalid token' }),
    });
    const service = new SupabaseAuthService(config, fetchMock);

    await expect(service.verifyAccessToken('bad-token')).rejects.toThrow('Invalid Supabase access token');
  });

  it('uses phone metadata when Supabase Auth phone is empty for email-password users', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'supabase-user-123',
        email: 'sender@example.com',
        phone: '',
        user_metadata: {
          phone: '+971501234567',
          country: 'AE',
          preferred_language: 'en',
          timezone: 'Asia/Dubai',
        },
      }),
    });
    const service = new SupabaseAuthService(config, fetchMock);

    const identity = await service.verifyAccessToken('access-token');

    expect(identity.phone).toBe('+971501234567');
  });
});
