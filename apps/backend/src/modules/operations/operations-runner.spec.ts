import { describe, expect, it, vi } from 'vitest';
import { runOperationsCheckIns } from './operations-runner';

describe('runOperationsCheckIns', () => {
  it('posts to the configured operations endpoint with the service-role bearer token', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          dueCheckIns: { created: 1, sent: 1, skipped: 0 },
          overdueEscalations: { checked: 2, escalated: 1, skipped: 1, failed: 0 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runOperationsCheckIns({
      endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
      serviceRoleKey: 'service-role-secret',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.nearby.example/operations/check-ins/run', {
      method: 'POST',
      headers: {
        authorization: 'Bearer service-role-secret',
        'content-type': 'application/json',
      },
    });
    expect(result).toEqual({
      ok: true,
      dueCheckIns: { created: 1, sent: 1, skipped: 0 },
      overdueEscalations: { checked: 2, escalated: 1, skipped: 1, failed: 0 },
    });
  });

  it('rejects missing configuration without exposing secret values', async () => {
    await expect(
      runOperationsCheckIns({
        endpointUrl: '',
        serviceRoleKey: 'service-role-secret',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('OPERATIONS_CHECK_INS_RUN_URL is required');

    await expect(
      runOperationsCheckIns({
        endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
        serviceRoleKey: '',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('SUPABASE_SERVICE_ROLE_KEY is required');
  });

  it('rejects failed endpoint responses without including response bodies', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('raw receiver phone +971501234567', { status: 401, statusText: 'Unauthorized' });
    });

    await expect(
      runOperationsCheckIns({
        endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
        serviceRoleKey: 'wrong-secret',
        fetchImpl,
      }),
    ).rejects.toThrow('Operations check-ins run failed with HTTP 401 Unauthorized');
  });

  it('returns only aggregate fields even if the endpoint response has unexpected details', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          receiverId: 'receiver-id-that-must-not-be-logged',
          phone: '+971501234567',
          dueCheckIns: { created: 1, sent: 1, skipped: 0, receiverId: 'nested-receiver-id' },
          overdueEscalations: { checked: 1, escalated: 0, skipped: 1, failed: 0, transcript: 'raw body' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runOperationsCheckIns({
      endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
      serviceRoleKey: 'service-role-secret',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      dueCheckIns: { created: 1, sent: 1, skipped: 0 },
      overdueEscalations: { checked: 1, escalated: 0, skipped: 1, failed: 0 },
    });
    expect(JSON.stringify(result)).not.toContain('receiver');
    expect(JSON.stringify(result)).not.toContain('phone');
    expect(JSON.stringify(result)).not.toContain('transcript');
  });
});
