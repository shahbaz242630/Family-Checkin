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

  it('keeps the rest of a typed error body as details so screens can show the date (CB-009)', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 429,
        json: async () => ({
          code: 'CONSENT_RESEND_LIMIT',
          message: 'A consent request was sent to this receiver in the last 7 days',
          nextAllowedAt: '2026-09-13T09:00:00.000Z',
          statusCode: 429,
        }),
      })),
    );

    const { resendReceiverConsent } = await import('./backendApi');

    await expect(resendReceiverConsent('receiver-1')).rejects.toMatchObject({
      name: 'BackendRequestError',
      status: 429,
      code: 'CONSENT_RESEND_LIMIT',
      details: { nextAllowedAt: '2026-09-13T09:00:00.000Z' },
    });
    const error = (await resendReceiverConsent('receiver-1').catch((err: unknown) => err)) as BackendRequestError;
    expect(Object.keys(error.details)).toEqual(['nextAllowedAt']);
  });

  it('returns an empty details object when the error body is not JSON', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: false,
        status: 502,
        json: async () => {
          throw new SyntaxError('not json');
        },
      })),
    );

    const { listReceivers } = await import('./backendApi');

    await expect(listReceivers()).rejects.toMatchObject({
      status: 502,
      message: 'Backend request failed with status 502',
      details: {},
    });
  });

  it('posts the consent resend for a receiver and returns the consent request status', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({
        receiver: {
          id: 'receiver-1',
          consentStatus: 'PENDING',
          consentRequestStatus: 'failed',
        },
      }),
    }));
    vi.stubGlobal('fetch', fetch);

    const { resendReceiverConsent } = await import('./backendApi');

    await expect(resendReceiverConsent('receiver-1')).resolves.toEqual({
      id: 'receiver-1',
      consentStatus: 'PENDING',
      consentRequestStatus: 'failed',
    });
    expect(fetch).toHaveBeenCalledWith(
      'https://backend.example/receivers/receiver-1/consent/resend',
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends the resolution note on resolve and nothing when there is none (CB-018)', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ receiver: { id: 'receiver-1' } }),
    }));
    vi.stubGlobal('fetch', fetch);

    const { resolveReceiverCheckIn } = await import('./backendApi');

    await resolveReceiverCheckIn('receiver-1', 'check-in-1', 'Spoke to her, all fine');
    await resolveReceiverCheckIn('receiver-1', 'check-in-1');

    expect(fetch).toHaveBeenNthCalledWith(
      1,
      'https://backend.example/receivers/receiver-1/check-ins/check-in-1/resolve',
      expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ note: 'Spoke to her, all fine' }) }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://backend.example/receivers/receiver-1/check-ins/check-in-1/resolve',
      expect.objectContaining({ method: 'PATCH', body: undefined }),
    );
  });

  it('returns the backup alert outcome next to the refreshed receiver (CB-074)', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({
          receiver: { id: 'receiver-1', latestCheckIn: { id: 'check-in-1', status: 'NEEDS_ATTENTION' } },
          backupAlert: { outcome: 'no_backup_contacts', alerted: 0, failed: 0 },
        }),
      })),
    );

    const { alertBackupForReceiverCheckIn } = await import('./backendApi');

    await expect(alertBackupForReceiverCheckIn('receiver-1', 'check-in-1')).resolves.toEqual({
      receiver: { id: 'receiver-1', latestCheckIn: { id: 'check-in-1', status: 'NEEDS_ATTENTION' } },
      backupAlert: { outcome: 'no_backup_contacts', alerted: 0, failed: 0 },
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
