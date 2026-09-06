import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppConfigService } from '../../shared/config/app-config.service';
import { SupabaseAuthService } from './supabase-auth.service';

describe('SupabaseAuthService', () => {
  const config = new AppConfigService({
    DATABASE_URL: 'postgresql://postgres:postgres@localhost:5432/nearby',
    KMS_MASTER_KEY_BASE64: Buffer.from('0123456789abcdef0123456789abcdef').toString('base64'),
    SUPABASE_URL: 'https://nearby-test-project.supabase.co',
    SUPABASE_ANON_KEY: 'anon-key',
    SUPABASE_SERVICE_ROLE_KEY: 'service-role-key',
    OPERATIONS_CRON_SECRET: 'operations-cron-secret',
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

    expect(fetchMock).toHaveBeenCalledWith('https://nearby-test-project.supabase.co/auth/v1/user', {
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

  it('carries the display name from full_name, falling back to name, and omits it when neither is set (CB-010)', async () => {
    const identityFor = async (user_metadata: Record<string, unknown>) => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'supabase-user-123',
          email: 'sender@example.com',
          phone: '+971501234567',
          user_metadata,
        }),
      });
      return new SupabaseAuthService(config, fetchMock).verifyAccessToken('access-token');
    };

    expect((await identityFor({ full_name: 'Sam Malik', name: 'sam' })).displayName).toBe('Sam Malik');
    expect((await identityFor({ name: 'Sam' })).displayName).toBe('Sam');
    expect(await identityFor({ full_name: '   ', name: 42 })).not.toHaveProperty('displayName');
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
