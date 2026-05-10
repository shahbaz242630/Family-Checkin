import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendRequestError } from './backendErrors';

vi.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

vi.mock('./supabase', () => ({
  getSession: vi.fn(async () => ({ access_token: 'access-token' })),
}));

describe('backend API error handling', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('preserves backend error codes on request failures', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 403,
        json: async () => ({
          code: 'PAID_ACCESS_REQUIRED',
          message: 'Active subscription required to add receivers',
        }),
      })),
    );

    const { createReceiver } = await import('./backendApi');

    await expect(
      createReceiver({
        name: 'Fatima Parent',
        phone: '+971501234567',
        countryCode: 'AE',
        relationshipType: 'PARENT',
        language: 'en',
        timezone: 'Asia/Dubai',
        techProfile: 'WHATSAPP',
        primaryChannel: 'WHATSAPP',
        fallbackChannels: ['SMS'],
        scheduleFrequency: 'daily',
        scheduleTimeWindow: { start: '09:00', end: '11:00' },
      }),
    ).rejects.toMatchObject({
      name: 'BackendRequestError',
      status: 403,
      code: 'PAID_ACCESS_REQUIRED',
      message: 'Active subscription required to add receivers',
    });
  });
});
