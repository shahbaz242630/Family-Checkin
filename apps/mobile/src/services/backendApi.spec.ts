import { afterEach, describe, expect, it, vi } from 'vitest';
import { BackendRequestError, EMPTY_RESPONSE_MESSAGE, UNREADABLE_RESPONSE_MESSAGE } from './backendErrors';

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
        text: async () =>
          JSON.stringify({
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
        text: async () =>
          JSON.stringify({
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
        text: async () => '<html>Bad gateway</html>',
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
      text: async () =>
        JSON.stringify({
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
      text: async () => JSON.stringify({ receiver: { id: 'receiver-1' } }),
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
        text: async () =>
          JSON.stringify({
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
      text: async () =>
        JSON.stringify({
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

describe('backend API transport hardening (CB-080)', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  function reply(status: number, text: string) {
    return { ok: status >= 200 && status < 300, status, text: async () => text };
  }

  it('retries a GET once when a 2xx arrives with an empty body and returns the second reply', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(reply(200, ''))
      .mockResolvedValueOnce(reply(200, JSON.stringify({ receivers: [{ id: 'receiver-1' }] })));
    vi.stubGlobal('fetch', fetch);

    const { listReceivers } = await import('./backendApi');

    await expect(listReceivers()).resolves.toEqual([{ id: 'receiver-1' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://backend.example/receivers',
      expect.objectContaining({ method: 'GET' }),
    );
  });

  it('explains a cut-off reply in plain words when the GET retry comes back empty too', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn().mockResolvedValue(reply(200, '   '));
    vi.stubGlobal('fetch', fetch);

    const { getReceiver } = await import('./backendApi');

    await expect(getReceiver('receiver-1')).rejects.toMatchObject({
      name: 'BackendTransportError',
      status: 200,
      reason: 'empty_body',
      message: EMPTY_RESPONSE_MESSAGE,
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('explains an unreadable 2xx body instead of surfacing a JSON parse error', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(200, '{"receivers": [')));

    const { listReceivers } = await import('./backendApi');

    const error = (await listReceivers().catch((err: unknown) => err)) as Error;
    expect(error.name).toBe('BackendTransportError');
    expect(error.message).toBe(UNREADABLE_RESPONSE_MESSAGE);
    expect(error.message).not.toMatch(/JSON/);
  });

  it('never retries a POST: a cut-off reply is reported after a single request', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn().mockResolvedValue(reply(201, ''));
    vi.stubGlobal('fetch', fetch);

    const { resendReceiverConsent } = await import('./backendApi');

    await expect(resendReceiverConsent('receiver-1')).rejects.toMatchObject({
      name: 'BackendTransportError',
      message: EMPTY_RESPONSE_MESSAGE,
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never retries a DELETE and treats an empty 2xx body as success when the caller discards it', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn().mockResolvedValue(reply(200, ''));
    vi.stubGlobal('fetch', fetch);

    const { deleteReceiver, deleteBackupContact } = await import('./backendApi');

    await expect(deleteReceiver('receiver-1', 'remove-token')).resolves.toBeUndefined();
    await expect(deleteBackupContact('receiver-1', 'backup-1')).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('still reports a DELETE that the server refused', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(404, JSON.stringify({ message: 'Receiver not found' }))));

    const { deleteReceiver } = await import('./backendApi');

    await expect(deleteReceiver('receiver-1', 'remove-token')).rejects.toMatchObject({
      name: 'BackendRequestError',
      status: 404,
      message: 'Receiver not found',
    });
  });

  it('retries a GET once after a dropped connection but not a POST', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Network request failed'))
      .mockResolvedValueOnce(reply(200, JSON.stringify({ receivers: [] })))
      .mockRejectedValueOnce(new TypeError('Network request failed'));
    vi.stubGlobal('fetch', fetch);

    const { listReceivers, resendReceiverConsent } = await import('./backendApi');

    await expect(listReceivers()).resolves.toEqual([]);
    await expect(resendReceiverConsent('receiver-1')).rejects.toThrow('Network request failed');
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('does not retry the account export even though it is a GET (the step-up token is single-use)', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    const fetch = vi.fn().mockResolvedValue(reply(200, ''));
    vi.stubGlobal('fetch', fetch);

    const { exportAccountData } = await import('./backendApi');

    await expect(exportAccountData('export-token')).rejects.toMatchObject({ name: 'BackendTransportError' });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('maps an empty error body to the status fallback message', async () => {
    vi.stubEnv('EXPO_PUBLIC_BACKEND_URL', 'https://backend.example');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(reply(409, '')));

    const { resendReceiverConsent } = await import('./backendApi');

    await expect(resendReceiverConsent('receiver-1')).rejects.toMatchObject({
      name: 'BackendRequestError',
      status: 409,
      message: 'Backend request failed with status 409',
      details: {},
    });
  });
});
