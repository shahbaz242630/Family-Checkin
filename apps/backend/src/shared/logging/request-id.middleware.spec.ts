import { describe, expect, it, vi } from 'vitest';
import { currentRequestId } from './request-context';
import { REQUEST_ID_HEADER, requestIdFromHeader, requestIdMiddleware } from './request-id.middleware';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function fakeResponse() {
  const headers = new Map<string, string>();
  return { headers, setHeader: (name: string, value: string) => headers.set(name.toLowerCase(), value) };
}

describe('requestIdMiddleware', () => {
  it('generates a request id, echoes it back and exposes it to everything the handler awaits', async () => {
    const response = fakeResponse();
    let seen: string | undefined;

    await new Promise<void>((resolve) => {
      requestIdMiddleware({ headers: {} }, response, () => {
        void (async () => {
          await Promise.resolve();
          seen = currentRequestId();
          resolve();
        })();
      });
    });

    expect(seen).toMatch(UUID);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe(seen);
  });

  it('reuses a caller-supplied UUID so a proxy can correlate end to end', () => {
    const response = fakeResponse();
    const next = vi.fn(() => {
      expect(currentRequestId()).toBe('2f1c9b1a-1111-4222-8333-444455556666');
    });

    requestIdMiddleware({ headers: { [REQUEST_ID_HEADER]: '2F1C9B1A-1111-4222-8333-444455556666' } }, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.headers.get(REQUEST_ID_HEADER)).toBe('2f1c9b1a-1111-4222-8333-444455556666');
  });

  it('replaces a header that is not a UUID, so a caller can never push PII into every log line', () => {
    const response = fakeResponse();

    requestIdMiddleware({ headers: { [REQUEST_ID_HEADER]: '+971501234567' } }, response, () => {});

    const requestId = response.headers.get(REQUEST_ID_HEADER);
    expect(requestId).toMatch(UUID);
    expect(requestId).not.toContain('971501234567');
  });

  it('leaves no request id outside a request', () => {
    expect(currentRequestId()).toBeUndefined();
  });
});

describe('requestIdFromHeader', () => {
  it('accepts only a UUID', () => {
    expect(requestIdFromHeader('2f1c9b1a-1111-4222-8333-444455556666')).toBe('2f1c9b1a-1111-4222-8333-444455556666');
    expect(requestIdFromHeader(['2f1c9b1a-1111-4222-8333-444455556666', 'second'])).toBe(
      '2f1c9b1a-1111-4222-8333-444455556666',
    );
    expect(requestIdFromHeader(' 2f1c9b1a-1111-4222-8333-444455556666 ')).toBe('2f1c9b1a-1111-4222-8333-444455556666');
    expect(requestIdFromHeader('Sadia Malik')).toBeUndefined();
    expect(requestIdFromHeader('447700900123')).toBeUndefined();
    expect(requestIdFromHeader('')).toBeUndefined();
    expect(requestIdFromHeader(undefined)).toBeUndefined();
  });
});
