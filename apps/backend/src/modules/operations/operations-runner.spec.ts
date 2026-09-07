import { describe, expect, it, vi } from 'vitest';
import { runOperationsCheckIns, runOperationsPushReceipts } from './operations-runner';

describe('runOperationsCheckIns', () => {
  it('posts to the configured operations endpoint with the operations cron bearer token', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          dueCheckIns: { created: 1, sent: 1, skipped: 0 },
          cascadeAttempts: { sent: 2, timedOut: 1, failed: 0, needsAttention: 0, skipped: 1 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runOperationsCheckIns({
      endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
      operationsCronSecret: 'operations-cron-secret',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.nearby.example/operations/check-ins/run', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operations-cron-secret',
        'content-type': 'application/json',
      },
    });
    expect(result).toEqual({
      ok: true,
      dueCheckIns: { created: 1, sent: 1, skipped: 0 },
      cascadeAttempts: { sent: 2, timedOut: 1, failed: 0, needsAttention: 0, skipped: 1 },
    });
  });

  it('rejects missing configuration without exposing secret values', async () => {
    await expect(
      runOperationsCheckIns({
        endpointUrl: '',
        operationsCronSecret: 'operations-cron-secret',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('OPERATIONS_CHECK_INS_RUN_URL is required');

    await expect(
      runOperationsCheckIns({
        endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
        operationsCronSecret: '',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('OPERATIONS_CRON_SECRET is required');
  });

  it('rejects failed endpoint responses without including response bodies', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('raw receiver phone +971501234567', { status: 401, statusText: 'Unauthorized' });
    });

    await expect(
      runOperationsCheckIns({
        endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
        operationsCronSecret: 'wrong-secret',
        fetchImpl,
      }),
    ).rejects.toThrow('Operations check-ins run failed with HTTP 401 Unauthorized');
  });

  it('reports a locked tick as ok with zero counts (CB-045)', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, locked: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await runOperationsCheckIns({
      endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
      operationsCronSecret: 'operations-cron-secret',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      locked: true,
      dueCheckIns: { created: 0, sent: 0, skipped: 0 },
      cascadeAttempts: { sent: 0, timedOut: 0, failed: 0, needsAttention: 0, skipped: 0 },
    });
  });

  it('rejects a body that carries neither counts nor a lock', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      runOperationsCheckIns({
        endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
        operationsCronSecret: 'operations-cron-secret',
        fetchImpl,
      }),
    ).rejects.toThrow('Operations check-ins run returned no dueCheckIns counts');
  });

  it('returns only aggregate fields even if the endpoint response has unexpected details', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(
        JSON.stringify({
          ok: true,
          receiverId: 'receiver-id-that-must-not-be-logged',
          phone: '+971501234567',
          dueCheckIns: { created: 1, sent: 1, skipped: 0, receiverId: 'nested-receiver-id' },
          cascadeAttempts: { sent: 0, timedOut: 1, failed: 0, needsAttention: 1, skipped: 1, transcript: 'raw body' },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });

    const result = await runOperationsCheckIns({
      endpointUrl: 'https://api.nearby.example/operations/check-ins/run',
      operationsCronSecret: 'operations-cron-secret',
      fetchImpl,
    });

    expect(result).toEqual({
      ok: true,
      dueCheckIns: { created: 1, sent: 1, skipped: 0 },
      cascadeAttempts: { sent: 0, timedOut: 1, failed: 0, needsAttention: 1, skipped: 1 },
    });
    expect(JSON.stringify(result)).not.toContain('receiver');
    expect(JSON.stringify(result)).not.toContain('phone');
    expect(JSON.stringify(result)).not.toContain('transcript');
  });
});

describe('runOperationsPushReceipts (CB-085)', () => {
  it('posts to the push-receipt endpoint with the operations cron bearer token and returns counts only', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true, checked: 4, received: 3, deactivated: 1, expired: 1 }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    const result = await runOperationsPushReceipts({
      endpointUrl: 'https://api.nearby.example/operations/push-receipts/run',
      operationsCronSecret: 'operations-cron-secret',
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledWith('https://api.nearby.example/operations/push-receipts/run', {
      method: 'POST',
      headers: {
        authorization: 'Bearer operations-cron-secret',
        'content-type': 'application/json',
      },
    });
    expect(result).toEqual({ ok: true, checked: 4, received: 3, deactivated: 1, expired: 1 });
    expect(JSON.stringify(result)).not.toContain('token');
    expect(JSON.stringify(result)).not.toContain('userId');
  });

  it('rejects missing configuration without exposing secret values', async () => {
    await expect(
      runOperationsPushReceipts({
        endpointUrl: '',
        operationsCronSecret: 'operations-cron-secret',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('OPERATIONS_PUSH_RECEIPTS_RUN_URL is required');

    await expect(
      runOperationsPushReceipts({
        endpointUrl: 'https://api.nearby.example/operations/push-receipts/run',
        operationsCronSecret: '',
        fetchImpl: vi.fn(),
      }),
    ).rejects.toThrow('OPERATIONS_CRON_SECRET is required');
  });

  it('rejects a failed endpoint response without including the response body', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response('ExponentPushToken[abc] belongs to +971501234567', {
        status: 401,
        statusText: 'Unauthorized',
      });
    });

    await expect(
      runOperationsPushReceipts({
        endpointUrl: 'https://api.nearby.example/operations/push-receipts/run',
        operationsCronSecret: 'operations-cron-secret',
        fetchImpl,
      }),
    ).rejects.toThrow('Operations push receipts run failed with HTTP 401 Unauthorized');
  });

  it('treats a response with missing counts as zeroes rather than failing the scheduler run', async () => {
    const fetchImpl = vi.fn(async () => {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    });

    await expect(
      runOperationsPushReceipts({
        endpointUrl: 'https://api.nearby.example/operations/push-receipts/run',
        operationsCronSecret: 'operations-cron-secret',
        fetchImpl,
      }),
    ).resolves.toEqual({ ok: true, checked: 0, received: 0, deactivated: 0, expired: 0 });
  });
});
