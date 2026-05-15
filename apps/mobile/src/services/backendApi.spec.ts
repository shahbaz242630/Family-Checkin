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

  it('sends the step-up token when deleting a receiver', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        receiver: { id: 'receiver-1', deleted: true },
      }),
    }));
    vi.stubGlobal('fetch', fetch);

    const { deleteReceiver } = await import('./backendApi');

    await deleteReceiver('receiver-1', 'remove-token');

    expect(fetch).toHaveBeenCalledWith(
      'https://backend.example/receivers/receiver-1',
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'x-nearby-step-up-token': 'remove-token',
        }),
      }),
    );
  });
});
